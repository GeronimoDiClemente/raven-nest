import { spawn } from 'node:child_process'

/**
 * El binario a correr, como lista de argumentos. Una env var lo puede envolver entero:
 *
 *   PG_DUMP_CMD="docker exec -i nest-memory-pg pg_dump"
 *
 * Existe porque en la máquina de desarrollo (Windows) no hay cliente de Postgres instalado —
 * `pg_dump` vive adentro del contenedor de la base. En el contenedor del servicio la variable
 * no está seteada y esto cae a `pg_dump` pelado, que es lo que instala el Dockerfile.
 */
export function resolveCommand(
  envVar: string,
  fallback: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const raw = (env[envVar] ?? '').trim()
  return raw ? raw.split(/\s+/) : [fallback]
}

/**
 * Parte una connection string en los argumentos que ve `argv` y el ambiente privado del hijo.
 *
 * La contraseña NO puede ir en `argv`: es legible por cualquier proceso de la máquina (en
 * Linux, `/proc/<pid>/cmdline`). Va por `PGPASSWORD`, que es lo que los binarios de Postgres
 * leen para exactamente este motivo.
 */
export function connectionEnv(databaseUrl: string): { args: string[]; env: Record<string, string> } {
  const u = new URL(databaseUrl)
  const password = decodeURIComponent(u.password)
  u.password = ''
  return { args: [u.toString()], env: password ? { PGPASSWORD: password } : {} }
}

function run(
  cmd: string[],
  extraArgs: string[],
  childEnv: Record<string, string>,
  stdin: Uint8Array | null,
  collectStdout: boolean
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const [bin, ...prefix] = cmd
    const child = spawn(bin, [...prefix, ...extraArgs], {
      env: { ...process.env, ...childEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const out: Buffer[] = []
    const err: Buffer[] = []
    if (collectStdout) child.stdout.on('data', (c: Buffer) => out.push(c))
    else child.stdout.resume()
    child.stderr.on('data', (c: Buffer) => err.push(c))

    child.on('error', (e) => reject(new Error(`${bin}: ${e.message}`)))
    child.on('close', (code) => {
      if (code === 0) return resolve(new Uint8Array(Buffer.concat(out)))
      reject(new Error(`${bin} salió con código ${code}: ${Buffer.concat(err).toString().trim()}`))
    })

    // El stdin se cierra siempre: `pg_dump` no lee nada y se quedaría esperando el EOF.
    if (stdin) child.stdin.end(Buffer.from(stdin))
    else child.stdin.end()
  })
}

/**
 * Un dump en formato custom (`-Fc`, comprimido y restaurable selectivamente) por stdout.
 *
 * Por stdout y no a un archivo a propósito: es lo que hace que el mismo código funcione tanto
 * con `pg_dump` local como envuelto en `docker exec`, donde un `-f /tmp/x` escribiría adentro
 * del contenedor y no acá.
 *
 * `--no-owner` y `--no-privileges` son lo que hace que el dump se pueda restaurar en una base
 * limpia con OTRO rol, que es precisamente el escenario de un desastre: la cuenta de Railway
 * no está, y hay que levantar esto en cualquier Postgres a mano.
 *
 * El dump se junta entero en memoria. Con la base en 8 MB sobra; arriba de ~100 MB hay que
 * pasar a streaming y subida multipart a R2.
 */
export async function pgDump(
  databaseUrl: string,
  opts: { env?: NodeJS.ProcessEnv } = {}
): Promise<Uint8Array> {
  const { args, env } = connectionEnv(databaseUrl)
  const cmd = resolveCommand('PG_DUMP_CMD', 'pg_dump', opts.env ?? process.env)
  return run(cmd, ['-Fc', '--no-owner', '--no-privileges', ...args], env, null, true)
}

/** Restaura un dump `-Fc` en la base que apunte `databaseUrl`, leyéndolo por stdin. */
export async function pgRestore(
  databaseUrl: string,
  dump: Uint8Array,
  opts: { env?: NodeJS.ProcessEnv } = {}
): Promise<void> {
  const { args, env } = connectionEnv(databaseUrl)
  const cmd = resolveCommand('PG_RESTORE_CMD', 'pg_restore', opts.env ?? process.env)
  await run(cmd, ['--no-owner', '--no-privileges', '-d', ...args], env, dump, false)
}
