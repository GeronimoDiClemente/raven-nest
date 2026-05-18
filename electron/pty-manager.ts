import { EventEmitter } from 'events'
import { join } from 'path'
import { mkdirSync } from 'fs'
import * as fs from 'fs'
import * as pty from 'node-pty'
import { SHELL, SHELL_ARGS, isWin } from './platform'
import { userHome } from './raven-home'

async function cwdReachable(p: string): Promise<boolean> {
  try {
    await Promise.race([
      fs.promises.stat(p),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))
    ])
    return true
  } catch { return false }
}

export interface ShellOverride {
  bin: string
  args: string[]
}

const BUFFER_MAX_LINES = 10_000

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

  async create(paneId: string, cmd: string, accountDir: string, repoPath?: string, shell?: ShellOverride): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.ptys.has(paneId)) return { ok: true }  // already running, don't recreate

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    }

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
    if (!(await cwdReachable(cwd))) {
      console.warn('[pty-manager] cwd not reachable, falling back to userHome', { paneId, requested: cwd })
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

      // Launch AI command after shell starts (skip if plain terminal).
      // On Windows, PowerShell takes 1-2s to initialise and writing blindly
      // before the prompt appears means the keystrokes get eaten. Poll: wait
      // for the first `data` event from the pty (which means PowerShell has
      // printed its prompt), then write the cmd. Keep a 5s safety timeout in
      // case data never arrives (e.g. silent shell). On non-Windows we keep
      // the short 500ms delay because POSIX shells warm up fast.
      if (cmd) {
        let primed = false
        const writeCmd = () => {
          if (primed) return
          primed = true
          this.startupTimers.delete(paneId)
          // Only write if the slot still owns THIS pty. A kill→create race
          // between scheduling and firing would otherwise write the cmd into
          // a fresh pty that wasn't asked to run it.
          if (this.ptys.get(paneId) === ptyProcess) {
            ptyProcess.write(`${cmd}\r`)
          }
        }
        if (isWin) {
          ptyProcess.onData(() => writeCmd())
          const timer = setTimeout(writeCmd, 5000)
          this.startupTimers.set(paneId, timer)
        } else {
          const timer = setTimeout(writeCmd, 500)
          this.startupTimers.set(paneId, timer)
        }
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
