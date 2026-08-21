import { spawn, type ChildProcess } from 'child_process'

export type InstallState = 'done' | 'failed' | 'cancelled'

/**
 * Allowlist of install commands keyed by AIType string. The renderer passes
 * only the aiType; the main process resolves the command here so the renderer
 * can never hand an arbitrary shell string to the spawner.
 *
 * REGLA: solo gestores de paquetes (npm, gh, pip). Nada de bajar un script y
 * ejecutarlo (`curl | bash`, `irm | iex`): ese patron es el que usa el malware
 * real para ejecutar en memoria, y Windows Defender lo levanta como
 * Trojan:Win32/Commando.A!ml aunque el script sea el instalador oficial del
 * proveedor — con nuestra app como causante de la alerta. Un CLI que solo se
 * instale asi (Cursor) NO va en esta lista: la UI manda al usuario a la web.
 */

export const INSTALL_COMMANDS: Record<string, string> = {
  claude:   'npm install -g @anthropic-ai/claude-code',
  gemini:   'npm install -g @google/gemini-cli',
  codex:    'npm install -g @openai/codex',
  copilot:  'gh extension install github/gh-copilot',
  opencode: 'npm install -g opencode-ai',
  // Binarios verificados contra el registry de npm (campo bin), no supuestos.
  deepseek: 'npm install -g @deepseek-ai/dsh',
  grok:     'npm install -g @xai-official/grok',
  qwen:     'npm install -g @qwen-code/qwen-code',
  // Aider es Python: pip tambien es gestor de paquetes, cumple la regla.
  aider:    'python -m pip install -U aider-chat',
  // Cursor no publica en npm: instalador propio, y el de Windows es otro
  // comando. Como el runner spawnea esto de verdad, mandar el de curl en
  // Windows seria mandarlo a fallar.
}

/** Comando de instalacion, o undefined si ese CLI no se instala desde Nest. */
export function installCommandFor(aiType: string): string | undefined {
  return INSTALL_COMMANDS[aiType]
}

const SECRET_RE = /(?:^|[\s=:])(?:token|key|password|secret|api[_-]?key)\s*[=:]\s*\S+/gi

function redact(line: string): string {
  return line.replace(SECRET_RE, (m) => m.replace(/[=:]\s*\S+/, (kv) => kv.replace(/\S+$/, '<redacted>')))
}

function isWindows(): boolean {
  return process.platform === 'win32'
}

const DEFAULT_TIMEOUT_MS = 180_000

interface ActiveRun {
  child: ChildProcess | null
  cancelled: boolean
  /** Resuelve la promesa del run sin esperar el exit del proceso. */
  finish: (state: InstallState) => void
}

export interface RunOpts {
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

export class CliInstallRunner {
  private active = new Map<string, ActiveRun>()

  run(
    key: string,
    cmd: string,
    onProgress: (line: string) => void,
    opts: RunOpts = {},
  ): Promise<{ state: InstallState; log: string }> {
    if (this.active.has(key)) {
      return Promise.reject(new Error(`install already running for ${key}`))
    }
    const env = opts.env ?? process.env
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    return new Promise((resolve) => {
      const log: string[] = []
      const slot: ActiveRun = { child: null, cancelled: false, finish: () => {} }
      this.active.set(key, slot)

      let finished = false
      const finish = (state: InstallState) => {
        if (finished) return
        finished = true
        this.active.delete(key)
        resolve({ state, log: log.join('\n') })
      }
      slot.finish = finish

      const push = (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (!line) continue
          const safe = redact(line)
          log.push(safe)
          onProgress(safe)
        }
      }

      push(`$ ${cmd}`)

      const child = isWindows()
        ? spawn(cmd, { env, shell: true })
        : spawn('/bin/sh', ['-c', cmd], { env })
      slot.child = child

      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        push(`error: install timed out after ${Math.round(timeoutMs / 1000)}s — killing`)
        try {
          if (isWindows()) {
            const pid = child.pid
            if (pid) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
          } else {
            child.kill('SIGTERM')
          }
        } catch {}
      }, timeoutMs)

      child.stdout?.on('data', (d) => push(d.toString('utf8')))
      child.stderr?.on('data', (d) => push(d.toString('utf8')))
      child.on('error', (err) => {
        clearTimeout(timer)
        push(`error: ${err.message}`)
        finish(slot.cancelled ? 'cancelled' : 'failed')
      })
      child.on('exit', (code, signal) => {
        clearTimeout(timer)
        if (slot.cancelled) return finish('cancelled')
        if (timedOut) return finish('failed')
        if (code === 0) return finish('done')
        push(`exited with code ${code ?? 'null'}${signal ? ' signal ' + signal : ''}`)
        finish('failed')
      })
    })
  }

  cancel(key: string): boolean {
    const slot = this.active.get(key)
    if (!slot) return false
    slot.cancelled = true
    const child = slot.child
    if (child) {
      if (isWindows()) {
        try {
          const pid = child.pid
          if (pid) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
        } catch { /* si taskkill falla igual resolvemos abajo */ }
      } else {
        try { child.kill('SIGTERM') } catch { /* idem */ }
      }
    }
    // NO esperamos el 'exit'. Un proceso puede quedar zombi —bloqueado por el
    // antivirus, esperando input— y entonces ese evento no llega nunca: la UI
    // se quedaba en "Installing..." para siempre con el boton Cancel sin
    // efecto visible. Resolvemos ya; si el exit llega despues, finish() esta
    // protegido contra doble resolucion.
    slot.finish('cancelled')
    return true
  }

  cancelAll(): void {
    for (const key of Array.from(this.active.keys())) this.cancel(key)
  }
}
