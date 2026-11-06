// El log del proceso main, a un archivo en la carpeta de logs del sistema.
//
// En la app empaquetada nadie lee el stdout: todo `console.*` del main se perdía, y con eso
// cada falla de producción (el auto-update que no baja, un spawn de PTY que falla, el sync que
// no sube) quedaba sin rastro. Varios comentarios del repo hablaban de un `main.log` que no
// existía. Ahora existe: `~/Library/Logs/Nest/main.log` en Mac, `%APPDATA%\Nest\logs` en
// Windows, `~/.config/Nest/logs` en Linux.
//
// Queda en la máquina del usuario y no sale de ahí. Escribe sincrónico a propósito: lo que más
// importa guardar es lo último antes de un crash, y un write en vuelo se pierde con el proceso.
// El main loguea poco (no pasa la salida de los PTY por acá), así que el costo es despreciable.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { format } from 'util'

export interface Registro {
  escribir(nivel: string, args: unknown[]): void
  readonly archivo: string
}

/** 5 MB por archivo y uno anterior (`main.old.log`): ~10 MB como mucho. */
export const TOPE_DEL_LOG = 5 * 1024 * 1024

export function crearRegistro(dir: string, tope = TOPE_DEL_LOG, ahora: () => Date = () => new Date()): Registro {
  const archivo = join(dir, 'main.log')
  const viejo = join(dir, 'main.old.log')
  let tamano = 0
  try {
    mkdirSync(dir, { recursive: true })
    tamano = statSync(archivo).size
  } catch { /* no existe todavía */ }

  const rotar = () => {
    try { renameSync(archivo, viejo) } catch { /* nada que rotar */ }
    tamano = 0
  }
  if (tamano >= tope) rotar()

  return {
    archivo,
    escribir(nivel, args) {
      const linea = `${ahora().toISOString()} ${nivel.padEnd(5)} ${format(...args)}\n`
      try {
        if (tamano + linea.length > tope) rotar()
        appendFileSync(archivo, linea)
        tamano += Buffer.byteLength(linea)
      } catch {
        // Disco lleno o carpeta sin permisos: el log no puede ser la razón de que la app falle.
      }
    },
  }
}

type Consola = Pick<Console, 'log' | 'info' | 'warn' | 'error'>

/**
 * Hace que `console.log/info/warn/error` del main escriban también en el archivo, sin dejar de
 * ir al stdout (en desarrollo se sigue viendo en la terminal). Devuelve cómo deshacerlo.
 */
export function duplicarConsola(registro: Registro, consola: Consola = console): () => void {
  const originales = { log: consola.log, info: consola.info, warn: consola.warn, error: consola.error }
  for (const nivel of ['log', 'info', 'warn', 'error'] as const) {
    const original = originales[nivel]
    consola[nivel] = (...args: unknown[]) => {
      registro.escribir(nivel === 'log' ? 'info' : nivel, args)
      original.apply(consola, args)
    }
  }
  return () => Object.assign(consola, originales)
}
