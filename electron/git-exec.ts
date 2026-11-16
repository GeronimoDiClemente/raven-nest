import { execFile } from 'child_process'

/**
 * `git <args>` sin bloquear el event loop del proceso main.
 *
 * Reemplaza a los `execFileSync('git', ...)` que corrían adentro de handlers IPC: mientras
 * uno de esos corría (un `git push` puede tardar hasta 60 s) se congelaban las terminales,
 * el IPC y la UI. Sin shell, igual que antes: los argumentos van como array y nada se
 * interpola en un string de comando.
 *
 * Diferencias con `execFileSync` que este helper absorbe para que los callers no cambien:
 * - stdin se cierra apenas arranca el proceso. `execFileSync` le da a git un stdin vacío
 *   (EOF inmediato); `execFile` le deja un pipe abierto, y si algo llegara a leerlo se
 *   quedaría esperando hasta el timeout.
 * - Un timeout rechaza con `code: 'ETIMEDOUT'` y el mismo mensaje que daba `execFileSync`
 *   (`spawnSync git ETIMEDOUT`), que es lo que algunos handlers le muestran al usuario.
 * - El error de cualquier otro fallo es el de `execFile`: `message` igual al de la versión
 *   síncrona (`Command failed: git ...\n<stderr>`), con `.stderr`/`.stdout` y `.code` (el
 *   exit code numérico, o `'ENOENT'` si no hay git en el PATH).
 *
 * Resuelve con el stdout recortado (`trim()`).
 */
export interface RunGitOptions {
  cwd?: string
  /** ms; 0 o ausente = sin timeout, igual que en `execFileSync`. */
  timeout?: number
}

export interface GitExecError extends Error {
  code?: number | string | null
  stdout?: string
  stderr?: string
  killed?: boolean
  signal?: NodeJS.Signals | null
}

export function runGit(args: string[], opts: RunGitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = opts.timeout ?? 0
    const child = execFile(
      'git',
      args,
      { cwd: opts.cwd, timeout, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as GitExecError
          e.stdout = stdout
          e.stderr = stderr
          if (timeout > 0 && e.killed) {
            e.code = 'ETIMEDOUT'
            e.message = 'spawnSync git ETIMEDOUT'
          }
          reject(e)
          return
        }
        resolve(stdout.trim())
      },
    )
    child.stdin?.end()
  })
}
