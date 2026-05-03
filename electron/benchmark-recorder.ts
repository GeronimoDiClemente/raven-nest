import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)
const isWindows = process.platform === 'win32'

export interface BenchSample {
  ts: number
  cpuPct: number | null  // 0-100
  rssMB: number | null
  mode: 'setup' | 'spotlight' | 'idle'
  processGone?: boolean
}

export interface BenchSession {
  cellId: string
  pid: number
  startedAt: number
  samples: BenchSample[]
  mode: 'setup' | 'spotlight' | 'idle'
}

const MAX_SAMPLES = 1200  // ~10 min at 500ms

async function sampleProcess(pid: number): Promise<{ cpuPct: number | null; rssMB: number | null; gone: boolean }> {
  if (isWindows) {
    try {
      const { stdout } = await execFileP('wmic', [
        'process',
        'where',
        `(processid=${pid})`,
        'get',
        'workingsetsize,kerneltime,usertime',
        '/format:csv',
      ], { timeout: 2000 })
      const lines = stdout.trim().split(/\r?\n/).filter((l) => l && !/^Node/i.test(l))
      const last = lines[lines.length - 1]
      if (!last) return { cpuPct: null, rssMB: null, gone: true }
      const parts = last.split(',')
      const ws = parseInt(parts[parts.length - 1] ?? '', 10)
      return {
        cpuPct: null,
        rssMB: Number.isFinite(ws) ? Math.round((ws / 1024 / 1024) * 10) / 10 : null,
        gone: false,
      }
    } catch {
      return { cpuPct: null, rssMB: null, gone: true }
    }
  }
  try {
    const { stdout } = await execFileP('ps', ['-o', 'pcpu=,rss=', '-p', String(pid)], { timeout: 2000 })
    const m = stdout.trim().match(/^\s*([\d.]+)\s+(\d+)/)
    if (!m) return { cpuPct: null, rssMB: null, gone: true }
    return {
      cpuPct: parseFloat(m[1]!),
      rssMB: Math.round((parseInt(m[2]!, 10) / 1024) * 10) / 10,
      gone: false,
    }
  } catch {
    return { cpuPct: null, rssMB: null, gone: true }
  }
}

export class BenchmarkRecorder {
  private sessions = new Map<string, BenchSession>()
  private timers = new Map<string, NodeJS.Timeout>()

  start(cellId: string, pid: number, mode: 'setup' | 'spotlight' | 'idle'): void {
    this.stop(cellId)
    const session: BenchSession = {
      cellId,
      pid,
      startedAt: Date.now(),
      samples: [],
      mode,
    }
    this.sessions.set(cellId, session)
    const tick = async () => {
      const s = this.sessions.get(cellId)
      if (!s) return
      const sample = await sampleProcess(s.pid)
      const entry: BenchSample = {
        ts: Date.now(),
        cpuPct: sample.cpuPct,
        rssMB: sample.rssMB,
        mode: s.mode,
        processGone: sample.gone || undefined,
      }
      s.samples.push(entry)
      if (s.samples.length > MAX_SAMPLES) s.samples.splice(0, s.samples.length - MAX_SAMPLES)
    }
    void tick()
    this.timers.set(cellId, setInterval(tick, 1000))
  }

  setMode(cellId: string, mode: 'setup' | 'spotlight' | 'idle'): void {
    const s = this.sessions.get(cellId)
    if (s) s.mode = mode
  }

  get(cellId: string): BenchSession | null {
    return this.sessions.get(cellId) ?? null
  }

  list(): BenchSession[] {
    return Array.from(this.sessions.values())
  }

  stop(cellId: string): void {
    const t = this.timers.get(cellId)
    if (t) { clearInterval(t); this.timers.delete(cellId) }
    this.sessions.delete(cellId)
  }

  stopAll(): void {
    for (const id of Array.from(this.timers.keys())) this.stop(id)
  }
}
