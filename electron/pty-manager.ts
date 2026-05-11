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

const BUFFER_MAX_LINES = 10_000

export class PtyManager extends EventEmitter {
  private ptys = new Map<string, pty.IPty>()
  private buffers = new Map<string, string[]>()

  create(paneId: string, cmd: string, accountDir: string, repoPath?: string, shell?: ShellOverride): { ok: true } | { ok: false; error: string } {
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
        setTimeout(() => ptyProcess.write(`${cmd}\r`), isWin ? 3000 : 500)
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
        this.ptys.delete(paneId)
        this.buffers.delete(paneId)
        this.emit('exit', paneId)
      })

      this.ptys.set(paneId, ptyProcess)
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
      } catch {
        // Ignore resize errors on exited PTY
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
    const ptyProc = this.ptys.get(paneId)
    if (ptyProc) {
      try { ptyProc.kill() } catch { /* already dead */ }
      this.ptys.delete(paneId)
    }
    this.buffers.delete(paneId)
  }

  killAll(): void {
    for (const id of this.ptys.keys()) this.kill(id)
  }
}
