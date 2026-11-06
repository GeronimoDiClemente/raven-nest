// El barrido de verdad: corre `ps` y `lsof` y le pasa la salida a `huerfanos-de-tareas.ts`.
// También mata un huérfano, después de volver a confirmar que lo sigue siendo: entre el
// barrido y el clic pasaron segundos o minutos, y el pid pudo haberse reciclado.
import { execFile } from 'child_process'
import { homedir } from 'os'
import { promisify } from 'util'
import {
  ARGUMENTOS_DE_PS, candidatos, detectarHuerfanos, grupoDe, parsearLsof, parsearPs,
  type FilaDeProceso, type Huerfano,
} from './huerfanos-de-tareas'
import { matarArbol, type ResultadoDeMatar } from './matar-arbol'

const correr = promisify(execFile)

async function foto(): Promise<{ filas: FilaDeProceso[]; huerfanos: Huerfano[] }> {
  const { stdout } = await correr('ps', ARGUMENTOS_DE_PS, { maxBuffer: 16 * 1024 * 1024 })
  const filas = parsearPs(stdout)
  const uid = process.getuid?.() ?? -1
  const pids = candidatos(filas, uid).map((f) => f.pid)
  if (pids.length === 0) return { filas, huerfanos: [] }
  let salidaDeLsof = ''
  try {
    ;({ stdout: salidaDeLsof } = await correr('lsof', ['-nP', '-a', '-d', '1,2', '-p', pids.join(','), '-Fpn'], { maxBuffer: 16 * 1024 * 1024 }))
  } catch (err) {
    // lsof sale con 1 cuando alguno de los pids ya no existe, pero igual imprime el resto.
    salidaDeLsof = (err as { stdout?: string }).stdout ?? ''
  }
  return { filas, huerfanos: detectarHuerfanos(filas, parsearLsof(salidaDeLsof), { uid, home: homedir() }) }
}

/** Los huérfanos de ahora. En Windows no hay: las tareas no corren con setsid ni en `/private/tmp`. */
export async function buscarHuerfanos(): Promise<Huerfano[]> {
  if (process.platform === 'win32') return []
  return (await foto()).huerfanos
}

const vivo = (pid: number) => {
  try { process.kill(pid, 0); return true } catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM' }
}

/** Mata el grupo entero del huérfano, si todavía es huérfano. */
export async function matarHuerfano(pid: number, o: { graciaMs?: number } = {}): Promise<ResultadoDeMatar> {
  if (process.platform === 'win32') return { ok: false, error: 'Not supported on Windows' }
  const { filas, huerfanos } = await foto()
  const h = huerfanos.find((x) => x.pid === pid)
  if (!h) return { ok: false, error: 'That process is no longer an orphan' }
  const grupo = grupoDe(filas, h.pgid)
  return matarArbol(pid, {
    arbolDe: async () => grupo,
    senal: (p, s) => { process.kill(p, s) },
    vivo,
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
  }, o)
}
