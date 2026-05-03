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
  child: ChildProcess
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

      const finish = (state: 'done' | 'failed' | 'cancelled') => {
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

        const slot: ActiveRun = { child, cancelled: false, log }
        this.active.set(run.worktreePath, slot)

        child.stdout?.on('data', (d) => pushLog(d.toString('utf8')))
        child.stderr?.on('data', (d) => pushLog(d.toString('utf8')))
        child.on('error', (err) => {
          pushLog(`error: ${err.message}`)
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
    if (isWindows()) {
      try {
        const pid = slot.child.pid
        if (pid) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
      } catch {}
    } else {
      try { slot.child.kill('SIGTERM') } catch {}
    }
    return true
  }

  isRunning(worktreePath: string): boolean {
    return this.active.has(worktreePath)
  }
}
