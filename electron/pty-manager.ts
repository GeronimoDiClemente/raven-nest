import { EventEmitter } from 'events'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import * as pty from 'node-pty'
import { SHELL, SHELL_ARGS, isWin } from './platform'
import { userHome } from './raven-home'

export interface ShellOverride {
  bin: string
  args: string[]
}

/**
 * Nest Memory integration point (docs/nest-memory-architecture.md §2.5). Injected as a
 * constructor dependency rather than imported directly so existing PtyManager tests
 * (worktree-integration, etc.) keep working with `new PtyManager()` and no memory
 * wiring at all.
 */
export interface PtyMemoryIntegration {
  socketPath: string
  isEnabled: () => boolean
  /** Returns `['--settings', '<path>']` for a provisioned Claude account, else `[]`. */
  getClaudeSettingsFlagArgs: (accountDir: string) => string[]
}

const BUFFER_MAX_LINES = 10_000

/**
 * accountDir is always `{ravenHome}/.raven-nest/accounts/{aiType}/{accountName}` (see
 * account-store.ts `getDir`). Parsing it here — rather than widening
 * `PtyManager.create()`'s signature to take aiType/accountName explicitly — keeps every
 * existing call site (main.ts's `pty:create` handler, and transitively preload/renderer)
 * unchanged. docs/nest-memory-architecture.md §2.5 calls the signature-change path
 * "cleaner" but explicitly allows derivation from accountDir as the alternative.
 */
export function parseAccountDir(accountDir: string): { aiType: string; accountName: string } | null {
  const parts = accountDir.split(/[\\/]/).filter(Boolean)
  const idx = parts.lastIndexOf('accounts')
  if (idx === -1 || idx + 2 >= parts.length) return null
  return { aiType: parts[idx + 1], accountName: parts[idx + 2] }
}

export class PtyManager extends EventEmitter {
  private ptys = new Map<string, pty.IPty>()
  private buffers = new Map<string, string[]>()
  // cwd at spawn time, per pane. Used by `killByCwdPrefix` so worktree:remove
  // can tear down every PTY whose working directory is inside the worktree
  // being deleted — otherwise Windows holds the directory handle open and
  // `rmSync` fails with EBUSY but the meta gets deleted anyway (ghost dir).
  private cwdByPaneId = new Map<string, string>()
  // Pending "write the cmd after shell warms up" timers per pane. Cleared on
  // kill() and on onExit so a teardown during the 3 s Windows delay doesn't
  // fire a write into a dead (or recreated) PTY.
  private startupTimers = new Map<string, NodeJS.Timeout>()
  private memory?: PtyMemoryIntegration

  constructor(memory?: PtyMemoryIntegration) {
    super()
    this.memory = memory
  }

  /** Late-binds the memory integration when it can't be ready at PtyManager construction
   *  time (main.ts constructs ptyManager before the memory subsystem). */
  setMemoryIntegration(memory: PtyMemoryIntegration): void {
    this.memory = memory
  }

  create(paneId: string, cmd: string, accountDir: string, repoPath?: string, shell?: ShellOverride): { ok: true } | { ok: false; error: string } {
    if (this.ptys.has(paneId)) return { ok: true }  // already running, don't recreate

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    }

    let launchCmd = cmd

    // Only redirect HOME for AI agent panes — plain terminals keep the real HOME
    // so system credentials (gh, git, ssh, etc.) work without reconfiguration.
    if (accountDir && cmd) {
      mkdirSync(accountDir, { recursive: true })
      env.HOME = accountDir
      if (isWin) {
        env.USERPROFILE = accountDir
        // HOMEDRIVE and HOMEPATH are also read by git, npm, and some AI CLIs on Windows
        const driveSep = accountDir.indexOf(':')
        if (driveSep !== -1) {
          env.HOMEDRIVE = accountDir.slice(0, driveSep + 1)
          env.HOMEPATH = accountDir.slice(driveSep + 1)
        }
      }

      // Gemini needs its own config subdir
      if (cmd === 'gemini') {
        const geminiHome = join(accountDir, 'gemini')
        mkdirSync(geminiHome, { recursive: true })
        env.GEMINI_CLI_HOME = geminiHome
      }

      // Nest Memory: env injection at PtyManager.create() (§2.5) — the one place every
      // AI pane passes through, same reasoning as the HOME rewrite above. Only claude is
      // provisioned in Phase 1; env is still injected for every AI type so a future
      // Codex/Gemini adapter (Phase 2) needs no pty-manager change.
      if (this.memory) {
        const parsed = parseAccountDir(accountDir)
        if (parsed) {
          env.NEST_MEMORY_SOCKET = this.memory.socketPath
          env.NEST_MEMORY_ACCOUNT = `${parsed.aiType}:${parsed.accountName}`
          env.NEST_MEMORY_AI = parsed.aiType
          env.NEST_MEMORY_PANE = paneId
          env.NEST_MEMORY_ENABLED = this.memory.isEnabled() ? '1' : '0'

          // §2.5 "the shared-config hazard": hooks load ONLY via the isolated
          // --settings file, never by writing accountDir/.claude/settings.json.
          if (cmd === 'claude' && this.memory.isEnabled()) {
            const flagArgs = this.memory.getClaudeSettingsFlagArgs(accountDir)
            if (flagArgs.length > 0) {
              launchCmd = `claude ${flagArgs.map((a) => (a.startsWith('-') ? a : `"${a}"`)).join(' ')}`
            }
          }
        }
      }
    } else if (accountDir) {
      mkdirSync(accountDir, { recursive: true })
    }

    const spawnBin = shell?.bin ?? SHELL
    const spawnArgs = shell?.args ?? SHELL_ARGS

    // Resolve cwd with existence check. CreateProcess on Windows fails with
    // ERROR_DIRECTORY (code 267) if cwd is missing — common when a tab persists
    // a repoPath that was later deleted. Fall back to the real user home via
    // userHome() (which un-nests but ignores RAVEN_HOME — RAVEN_HOME is for
    // storage redirection, not for cwd). Never accountDir — that's the AI's
    // config dir, not a meaningful working directory.
    let cwd = repoPath || userHome()
    if (!existsSync(cwd)) {
      console.warn('[pty-manager] cwd does not exist, falling back to userHome', { paneId, requested: cwd })
      cwd = userHome()
    }

    try {
      const ptyProcess = pty.spawn(spawnBin, spawnArgs, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        env,
        cwd,
      })

      // Launch AI command after shell starts (skip if plain terminal)
      // PowerShell on Windows can take 1-2s to initialise — use a longer delay
      if (cmd) {
        const timer = setTimeout(() => {
          this.startupTimers.delete(paneId)
          // Only write if the slot still owns THIS pty. A kill→create race
          // between scheduling and firing would otherwise write the cmd into
          // a fresh pty that wasn't asked to run it.
          if (this.ptys.get(paneId) === ptyProcess) {
            ptyProcess.write(`${launchCmd}\r`)
          }
        }, isWin ? 3000 : 500)
        this.startupTimers.set(paneId, timer)
      }

      ptyProcess.onData((data) => {
        this.emit('data', paneId, data)
        const lines = this.buffers.get(paneId) ?? []
        lines.push(data)
        if (lines.length > BUFFER_MAX_LINES) lines.splice(0, lines.length - BUFFER_MAX_LINES)
        this.buffers.set(paneId, lines)
      })

      ptyProcess.onExit(() => {
        // Identity guard: if a kill→create raced, the slot is already owned by a new
        // process. Don't wipe its state or fire 'exit' for a stale paneId.
        const current = this.ptys.get(paneId)
        if (current && current !== ptyProcess) return
        // Clear any pending startup-write timer for THIS pty before tearing
        // down — otherwise a delayed write could land in the next pane that
        // reuses the paneId.
        const pending = this.startupTimers.get(paneId)
        if (pending) {
          clearTimeout(pending)
          this.startupTimers.delete(paneId)
        }
        this.ptys.delete(paneId)
        this.buffers.delete(paneId)
        this.emit('exit', paneId)
      })

      this.ptys.set(paneId, ptyProcess)
      this.cwdByPaneId.set(paneId, cwd)
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[pty-manager] spawn failed', { paneId, spawnBin, spawnArgs, error: message })
      return { ok: false, error: message }
    }
  }

  write(paneId: string, data: string): void {
    this.ptys.get(paneId)?.write(data)
  }

  resize(paneId: string, cols: number, rows: number): void {
    const ptyProc = this.ptys.get(paneId)
    if (ptyProc) {
      try {
        ptyProc.resize(cols, rows)
      } catch (err) {
        // Resize on an exited PTY is the common case during teardown — keep it
        // as debug (not warn) so we don't spam main.log, but DO log it so a
        // genuinely broken resize (e.g. conpty hiccup on live pane) leaves a
        // breadcrumb instead of vanishing.
        console.debug('[pty-manager] resize failed', paneId, err instanceof Error ? err.message : err)
      }
    }
  }

  exists(paneId: string): boolean {
    return this.ptys.has(paneId)
  }

  getPid(paneId: string): number | undefined {
    return this.ptys.get(paneId)?.pid
  }

  /**
   * Snapshot of every live pane's PID. Used by the BrowserCell port dropdown
   * to enumerate all listening ports across the whole app without depending
   * on the renderer's view of which panes exist.
   */
  getAllPids(): Array<{ paneId: string; pid: number }> {
    const out: Array<{ paneId: string; pid: number }> = []
    for (const [paneId, pty] of this.ptys) {
      if (Number.isFinite(pty.pid) && pty.pid > 0) {
        out.push({ paneId, pid: pty.pid })
      }
    }
    return out
  }

  getBuffer(paneId: string): string {
    return (this.buffers.get(paneId) ?? []).join('')
  }

  kill(paneId: string): void {
    // Clear any pending startup-write timer FIRST. If the pane is killed
    // before the 3 s Windows warmup elapses, the timer would otherwise fire a
    // write into a dead (or recreated) pty.
    const pending = this.startupTimers.get(paneId)
    if (pending) {
      clearTimeout(pending)
      this.startupTimers.delete(paneId)
    }
    const ptyProc = this.ptys.get(paneId)
    if (ptyProc) {
      try { ptyProc.kill() } catch { /* already dead */ }
      this.ptys.delete(paneId)
    }
    this.buffers.delete(paneId)
    this.cwdByPaneId.delete(paneId)
  }

  killAll(): void {
    for (const id of this.ptys.keys()) this.kill(id)
  }

  /**
   * Kill every pane whose cwd lives inside `prefix`. Returns the paneIds that
   * were killed. Used by `worktree:remove` so Windows doesn't hit EBUSY when
   * deleting a worktree directory that a PowerShell pane is currently sitting
   * inside.
   */
  killByCwdPrefix(prefix: string): string[] {
    const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    const target = norm(prefix)
    const targetSlash = target + '/'
    const killed: string[] = []
    for (const [paneId, cwd] of Array.from(this.cwdByPaneId.entries())) {
      const cwdN = norm(cwd)
      if (cwdN === target || cwdN.startsWith(targetSlash)) {
        this.kill(paneId)
        killed.push(paneId)
      }
    }
    return killed
  }
}
