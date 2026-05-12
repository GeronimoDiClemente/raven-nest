import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

export type SetupState = 'running' | 'done' | 'failed' | 'cancelled'

export interface SetupRun {
  worktreePath: string
  presetId: string
  commands: string[]
  env: Record<string, string>
}

interface ActiveRun {
  child: ChildProcess | null
  cancelled: boolean
  log: string[]
}

const MAX_LOG_LINES = 200

const SECRET_RE = /(?:^|[\s=:])(?:token|key|password|secret|api[_-]?key)\s*[=:]\s*\S+/gi

function redact(line: string): string {
  return line.replace(SECRET_RE, (m) => m.replace(/[=:]\s*\S+/, (kv) => kv.replace(/\S+$/, '<redacted>')))
}

function isWindows(): boolean {
  return process.platform === 'win32'
}

export class SetupRunner extends EventEmitter {
  private active = new Map<string, ActiveRun>()

  run(run: SetupRun): Promise<{ state: Exclude<SetupState, 'running'>; log: string }> {
    if (this.active.has(run.worktreePath)) {
      return Promise.reject(new Error('setup already running for this worktree'))
    }
    return new Promise((resolve) => {
      const log: string[] = []
      const queue = [...run.commands]
      // One slot shared across all queued commands so that cancel() flips the
      // same `cancelled` flag the next iteration's exit handler reads. The
      // previous design created a new slot per command, so cancel() between
      // commands toggled the old slot and the new spawn ran unchecked.
      const slot: ActiveRun = { child: null, cancelled: false, log }
      this.active.set(run.worktreePath, slot)

      let finished = false
      const finish = (state: 'done' | 'failed' | 'cancelled') => {
        if (finished) return
        finished = true
        this.active.delete(run.worktreePath)
        this.emit('state', run.worktreePath, state)
        resolve({ state, log: log.join('\n') })
      }

      const pushLog = (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (!line) continue
          const safe = redact(line)
          log.push(safe)
          if (log.length > MAX_LOG_LINES) log.splice(0, log.length - MAX_LOG_LINES)
          this.emit('progress', run.worktreePath, safe)
        }
      }

      const runNext = () => {
        if (slot.cancelled) {
          finish('cancelled')
          return
        }
        const cmd = queue.shift()
        if (!cmd) {
          finish('done')
          return
        }
        pushLog(`$ ${cmd}`)
        const env = { ...process.env, ...run.env }
        const child = isWindows()
          ? spawn(cmd, { cwd: run.worktreePath, env, shell: true })
          : spawn('/bin/sh', ['-c', cmd], { cwd: run.worktreePath, env })

        slot.child = child

        child.stdout?.on('data', (d) => pushLog(d.toString('utf8')))
        child.stderr?.on('data', (d) => pushLog(d.toString('utf8')))
        child.on('error', (err) => {
          pushLog(`error: ${err.message}`)
          // Without this, a spawn failure (ENOENT, missing shell, etc.) leaves
          // the runner stuck in `running` forever — `exit` may never fire.
          finish(slot.cancelled ? 'cancelled' : 'failed')
        })
        child.on('exit', (code, signal) => {
          if (slot.cancelled) {
            finish('cancelled')
            return
          }
          if (code === 0) {
            runNext()
            return
          }
          pushLog(`exited with code ${code ?? 'null'}${signal ? ' signal ' + signal : ''}`)
          finish('failed')
        })
      }

      this.emit('state', run.worktreePath, 'running')
      runNext()
    })
  }

  cancel(worktreePath: string): boolean {
    const slot = this.active.get(worktreePath)
    if (!slot) return false
    slot.cancelled = true
    const child = slot.child
    if (!child) return true
    if (isWindows()) {
      try {
        const pid = child.pid
        if (pid) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
      } catch {}
    } else {
      try { child.kill('SIGTERM') } catch {}
    }
    return true
  }

  isRunning(worktreePath: string): boolean {
    return this.active.has(worktreePath)
  }

  /**
   * Cancel every active setup run. Called from app `before-quit` so spawned
   * children (npm install, pnpm i, etc.) don't outlive the parent process
   * and stay orphaned on the user's machine.
   */
  cancelAll(): void {
    for (const wt of Array.from(this.active.keys())) {
      this.cancel(wt)
    }
  }
}
