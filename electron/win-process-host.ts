import { spawn as nodeSpawn } from 'child_process'
import type { ChildProcessWithoutNullStreams } from 'child_process'

// One long-lived PowerShell that answers "give me the process table" over
// stdin/stdout, instead of spawning a fresh powershell.exe on every metrics
// cycle.
//
// Why: the old code launched `powershell.exe -Command Get-CimInstance ...`
// every poll cycle, plus pidusage launched its own `powershell -c gwmi ...`
// per call. Measured on Windows 11 26200 (2026-10-13), each powershell.exe
// start leaves kernel access tokens behind (pool tag `Toke`) in bursts that
// are only freed by a real reboot, and Fast Startup carries them across
// shutdowns. After ~25 days that machine had 2.85 M live tokens, ~8 GB of
// paged pool. Querying CIM from an already-running PowerShell barely moves the
// counter, so the fix is to start PowerShell once and keep it.

export interface WinProcRow {
  ProcessId?: number
  ParentProcessId?: number
  Name?: string
  ExecutablePath?: string | null
  CommandLine?: string | null
  WorkingSetSize?: number | null
  KernelModeTime?: number | null
  UserModeTime?: number | null
}

// Printed on its own line after every response. PowerShell 5.1's
// ConvertTo-Json escapes `<` and `>` as < / >, so the marker can
// never appear inside the JSON payload itself.
export const END_MARKER = '<<NEST-PROCS-END>>'

const QUERY =
  'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,WorkingSetSize,KernelModeTime,UserModeTime' +
  ' | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,WorkingSetSize,KernelModeTime,UserModeTime'

// The loop reads one request line at a time. `@(...)` keeps the output an
// array even when CIM returns a single row; on any failure it answers `[]` so
// the caller is never left waiting for a marker that won't come.
const HOST_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq 'exit') { break }
  try {
    $rows = @(${QUERY})
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $rows -Compress -Depth 2))
  } catch {
    [Console]::Out.WriteLine('[]')
  }
  [Console]::Out.WriteLine('${END_MARKER}')
  [Console]::Out.Flush()
}
`

export type SpawnFn = (
  command: string,
  args: string[],
  options: { windowsHide: boolean; stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams

export interface WinProcessHostOptions {
  spawnFn?: SpawnFn
  requestTimeoutMs?: number
  now?: () => number
}

interface Pending {
  resolve: (rows: WinProcRow[]) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

const MIN_BACKOFF_MS = 2_000
const MAX_BACKOFF_MS = 60_000

export class WinProcessHost {
  private child: ChildProcessWithoutNullStreams | null = null
  private stdoutBuf = ''
  private responseLines: string[] = []
  private pending: Pending | null = null
  // Serialises requests: the protocol is strictly one request in flight.
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false
  // Crash-loop guard: after an unexpected exit, wait before respawning and
  // double the wait on each consecutive failure.
  private backoffMs = 0
  private notBefore = 0
  private warnedStderr = false

  private readonly spawnFn: SpawnFn
  private readonly requestTimeoutMs: number
  private readonly now: () => number

  constructor(opts: WinProcessHostOptions = {}) {
    this.spawnFn = opts.spawnFn ?? (nodeSpawn as unknown as SpawnFn)
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 8_000
    this.now = opts.now ?? Date.now
  }

  /** Full Win32_Process table. Rejects when the host is unavailable. */
  query(): Promise<WinProcRow[]> {
    const run = this.queue.then(() => this.runQuery())
    // Keep the chain alive regardless of this request's outcome.
    this.queue = run.catch(() => undefined)
    return run
  }

  dispose(): void {
    this.disposed = true
    this.failPending(new Error('process host disposed'))
    const child = this.child
    this.child = null
    if (!child) return
    try { child.stdin.write('exit\n') } catch {}
    try { child.kill() } catch {}
  }

  private runQuery(): Promise<WinProcRow[]> {
    if (this.disposed) return Promise.reject(new Error('process host disposed'))
    const child = this.ensureChild()
    if (!child) return Promise.reject(new Error('process host restarting'))
    return new Promise<WinProcRow[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        // A hung PowerShell would block every later request: kill it so the
        // next query starts a clean one.
        this.failPending(new Error('process host timed out'))
        this.killChild()
      }, this.requestTimeoutMs)
      this.pending = { resolve, reject, timer }
      try {
        child.stdin.write('snap\n')
      } catch (err) {
        this.failPending(err instanceof Error ? err : new Error(String(err)))
        this.killChild()
      }
    })
  }

  private ensureChild(): ChildProcessWithoutNullStreams | null {
    if (this.child) return this.child
    if (this.now() < this.notBefore) return null

    const encoded = Buffer.from(HOST_SCRIPT, 'utf16le').toString('base64')
    let child: ChildProcessWithoutNullStreams
    try {
      child = this.spawnFn(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      )
    } catch (err) {
      console.warn('[metrics] could not start process host', err instanceof Error ? err.message : err)
      this.scheduleBackoff()
      return null
    }
    this.child = child
    this.stdoutBuf = ''
    this.responseLines = []

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      // Late output from a child we already killed must not complete a
      // request sent to its replacement.
      if (this.child === child) this.onStdout(chunk)
    })
    // stderr must be drained or a chatty PowerShell blocks on a full pipe.
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      // PowerShell announces progress records as CLIXML on stderr when its
      // output is redirected; that is noise, not an error worth the one warn.
      if (this.warnedStderr || chunk.startsWith('#< CLIXML')) return
      this.warnedStderr = true
      console.warn('[metrics] process host stderr:', chunk.slice(0, 300))
    })
    child.stdin.on('error', () => { /* surfaced through 'exit' */ })
    child.on('error', (err) => {
      console.warn('[metrics] process host error', err.message)
      this.onChildGone(child)
    })
    child.on('exit', () => this.onChildGone(child))
    return child
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk
    let nl = this.stdoutBuf.indexOf('\n')
    while (nl !== -1) {
      const line = this.stdoutBuf.slice(0, nl).replace(/\r$/, '')
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1)
      if (line === END_MARKER) {
        this.completeResponse(this.responseLines.join('\n'))
        this.responseLines = []
      } else {
        this.responseLines.push(line)
      }
      nl = this.stdoutBuf.indexOf('\n')
    }
  }

  private completeResponse(payload: string): void {
    const p = this.pending
    if (!p) return
    this.pending = null
    clearTimeout(p.timer)
    // A full round trip worked: forget earlier failures.
    this.backoffMs = 0
    try {
      const parsed: unknown = JSON.parse(payload || '[]')
      p.resolve(Array.isArray(parsed) ? (parsed as WinProcRow[]) : [])
    } catch (err) {
      p.reject(new Error(`process host sent invalid JSON (len=${payload.length}): ${err instanceof Error ? err.message : err}`))
    }
  }

  private onChildGone(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return
    this.child = null
    this.failPending(new Error('process host exited'))
    if (!this.disposed) this.scheduleBackoff()
  }

  private scheduleBackoff(): void {
    this.backoffMs = this.backoffMs === 0 ? MIN_BACKOFF_MS : Math.min(this.backoffMs * 2, MAX_BACKOFF_MS)
    this.notBefore = this.now() + this.backoffMs
  }

  private killChild(): void {
    const child = this.child
    if (!child) return
    this.child = null
    this.scheduleBackoff()
    try { child.kill() } catch {}
  }

  private failPending(err: Error): void {
    const p = this.pending
    if (!p) return
    this.pending = null
    clearTimeout(p.timer)
    p.reject(err)
  }
}

// ---------------------------------------------------------------------------
// CPU accounting from successive snapshots (replaces pidusage on Windows).
// ---------------------------------------------------------------------------

export interface CpuSample {
  ctimeMs: number
  at: number
}

/**
 * Same formula pidusage uses on Windows: CPU time consumed since the previous
 * sample divided by wall time elapsed, ×100. Summed across cores, so one
 * pinned core reads 100 regardless of core count (callers divide by CPU count).
 * A pid seen for the first time reads 0, as pidusage's immediate re-sample
 * effectively does. A CPU time that went backwards means the pid was reused
 * by a new process, which also reads 0.
 */
export function cpuPercentSince(prev: CpuSample | undefined, cur: CpuSample): number {
  if (!prev) return 0
  const dt = cur.at - prev.at
  const dc = cur.ctimeMs - prev.ctimeMs
  if (dt <= 0 || dc < 0) return 0
  return (dc / dt) * 100
}

/** KernelModeTime + UserModeTime come in 100 ns units; returns milliseconds. */
export function cpuTimeMs(row: WinProcRow): number {
  const k = typeof row.KernelModeTime === 'number' ? row.KernelModeTime : 0
  const u = typeof row.UserModeTime === 'number' ? row.UserModeTime : 0
  return (k + u) / 10_000
}
