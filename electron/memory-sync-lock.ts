// §6.3 del spec `docs/superpowers/specs/2026-09-13-nest-memory-portable-design.md`:
// el candado de sincronización.
//
// Escribir en la base local desde dos procesos NO es el problema — el store abre en
// WAL, que serializa escritores, y el lamport se asigna adentro de la transacción
// desde el esquema 8. El problema es **sincronizar** dos veces: dos daemons sobre la
// misma cuenta significan dos copias del token y dos pushers compitiendo (decisión 2
// de `docs/nest-memory-architecture.md`).
//
// Este candado es la única pieza de coordinación nueva, y cierra tres casos:
//   - dos Nest: la app instalada y un build de desarrollo comparten `~/.raven-nest`.
//     **Esto ya pasa hoy**, sin paquete portátil de por medio, y nada lo detectaba.
//   - Nest + paquete portátil.
//   - dos paquetes portátiles.
//
// Quien no consigue el candado NO sincroniza: escribe local, encola en el
// `mutation_log` y lo dice. No se pierde nada.
import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import { hostname } from 'os'

export interface CandadoInfo {
  pid: number
  host: string
  at: number
}

export interface CandadoDeps {
  pid: number
  host: string
  now: () => number
  /** `false` si ese PID ya no existe en ESTA máquina. */
  pidVivo: (pid: number) => boolean
  /**
   * Cuánto vale un candado de OTRA máquina antes de considerarlo abandonado. Sólo
   * aplica a candados ajenos: los locales se deciden por PID, que es exacto.
   */
  ttlMs?: number
}

export interface Candado {
  /** Refresca el momento. El holder lo llama durante un sync largo. */
  heartbeat(): void
  release(): void
}

export type ResultadoCandado =
  | { ok: true; lock: Candado }
  | { ok: false; holder: CandadoInfo }

const TTL_POR_DEFECTO = 60_000

export function leerCandado(path: string): CandadoInfo | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<CandadoInfo>
    if (typeof raw?.pid !== 'number' || typeof raw?.host !== 'string' || typeof raw?.at !== 'number') {
      return null
    }
    return { pid: raw.pid, host: raw.host, at: raw.at }
  } catch {
    // No existe, o está ilegible. Un candado que no se puede leer NO puede bloquear
    // la sincronización para siempre: se trata como muerto.
    return null
  }
}

export function tomarCandadoDeSync(path: string, deps: CandadoDeps): ResultadoCandado {
  const ttlMs = deps.ttlMs ?? TTL_POR_DEFECTO
  const actual = leerCandado(path)

  if (actual && !estaMuerto(actual, deps, ttlMs)) {
    return { ok: false, holder: actual }
  }

  const mio: CandadoInfo = { pid: deps.pid, host: deps.host, at: deps.now() }
  writeFileSync(path, JSON.stringify(mio))

  // Las dos operaciones del holder comprueban lo mismo antes de tocar el archivo: que
  // el candado siga siendo NUESTRO. Si otro lo robó porque nos vio muertos, ni
  // refrescarlo ni borrarlo son nuestros para hacer — las dos cosas dejarían a ese
  // otro sincronizando sin candado, que es exactamente lo que este módulo evita.
  const sigueSiendoMio = (): boolean => {
    const ahora = leerCandado(path)
    return !!ahora && ahora.pid === deps.pid && ahora.host === deps.host
  }

  return {
    ok: true,
    lock: {
      heartbeat() {
        if (!sigueSiendoMio()) return
        writeFileSync(path, JSON.stringify({ ...mio, at: deps.now() }))
      },
      release() {
        if (!sigueSiendoMio()) return
        try { unlinkSync(path) } catch { /* ya no está, es el resultado buscado */ }
      },
    },
  }
}

function estaMuerto(info: CandadoInfo, deps: CandadoDeps, ttlMs: number): boolean {
  // Mismo host: el PID es una respuesta exacta, no hace falta esperar ningún ttl.
  if (info.host === deps.host) return !deps.pidVivo(info.pid)
  // Otra máquina: su PID no significa nada acá, así que lo único que queda es la
  // antigüedad. El holder la refresca con heartbeat() mientras sigue vivo.
  return deps.now() - info.at > ttlMs
}

/** El candado va AL LADO de la base, no adentro: es un archivo aparte, por base. */
export function lockPathParaBase(dbPath: string): string {
  return join(dirname(dbPath), 'sync.lock')
}

/**
 * Las deps reales del proceso. `kill` se inyecta sólo para poder testear las dos
 * respuestas del sistema operativo sin depender de procesos ajenos.
 */
export function candadoDepsDelProceso(
  over: { kill?: (pid: number, sig: 0) => void } = {},
): CandadoDeps {
  const kill = over.kill ?? ((pid: number, sig: 0) => { process.kill(pid, sig) })
  return {
    pid: process.pid,
    host: hostname(),
    now: () => Date.now(),
    pidVivo: (pid) => {
      // `kill(0, 0)` no pregunta por el pid 0: señala el GRUPO de procesos de quien llama,
      // y un negativo es otro grupo. Los dos darían "vivo" siempre, así que un candado
      // corrupto con pid 0 bloquearía la sincronización para siempre.
      if (!Number.isInteger(pid) || pid <= 0) return false
      try {
        kill(pid, 0)
        return true
      } catch (err) {
        // ESRCH = no existe, está muerto. EPERM = EXISTE pero es de otro usuario y no lo
        // podemos señalar: eso es VIVO. Tratarlo como muerto le robaría el candado a un
        // Nest corriendo bajo otra cuenta del sistema.
        return (err as NodeJS.ErrnoException)?.code === 'EPERM'
      }
    },
  }
}
