// `doctor` como DATOS: por qué no anda, sin imprimir. El CLI lo pinta; la TUI muestra el mismo
// contenido y además lo bloqueado con su razón.
import type { DecisionDeBase } from './base-para-el-paquete'
import type { BaseSqlite } from './sqlite-forma'
import type { FilaDeEstado } from './status-del-paquete'
import { acortarHome } from './estilo-del-paquete'

export const NODE_MINIMO = '22.5.0'

/** ¿Alcanza esta versión de Node (`22.5.0`, con o sin `v`)? Piso: 22.5, el de `node:sqlite`. */
export function nodeAlcanza(version: string): boolean {
  const [may, men] = version.replace(/^v/, '').split('.').map(Number)
  return (may ?? 0) > 22 || ((may ?? 0) === 22 && (men ?? 0) >= 5)
}

export interface Bloqueada { syncId: string | null; titulo: string; motivo: string }

export interface DatosDeDoctor {
  /** Node, Home, Nest, Memory, Keyring. */
  filas: FilaDeEstado[]
  /** El aviso «This HOME looks like a Nest account folder». */
  homeDeNest: boolean
  /** `mutation_log` con `blocked_reason` y `pushed_at IS NULL`. */
  bloqueadas: Bloqueada[]
  problemas: number
  avisos: number
}

export interface DependenciasDeDoctor {
  home: string
  /** El HOME real del usuario (`userInfo().homedir`): el de la fila Home se acorta sólo contra él. */
  homeReal: string
  /** Los HOME contra los que se acorta un path (el redirigido y el real). */
  homes: string[]
  /** `process.version`, con la `v`. */
  versionDeNode: string
  base: DecisionDeBase
  /** ¿Nest declaró una base activa en esta máquina? */
  hayPunteroDeNest: boolean
  llaveroDisponible: boolean
  abrirSoloLectura: (path: string) => BaseSqlite
}

/** El título de una mutación del log; `memory.doctor` del daemon lo lee igual. */
export function tituloDelPayload(payload: string): string {
  try {
    const t = (JSON.parse(payload) as { title?: unknown }).title
    return typeof t === 'string' && t.trim() ? t : '(untitled)'
  } catch {
    return '(untitled)'
  }
}

function leerBloqueadas(d: DependenciasDeDoctor): Bloqueada[] {
  const base = d.base
  if (base.modo === 'daemon' || (base.modo === 'propia' && base.nueva)) return []
  let db: BaseSqlite
  try { db = d.abrirSoloLectura(base.path) } catch { return [] }
  try {
    const filas = db.prepare(
      'SELECT sync_id, payload, blocked_reason FROM mutation_log WHERE blocked_reason IS NOT NULL AND pushed_at IS NULL ORDER BY seq ASC'
    ).all() as Array<{ sync_id: string | null; payload: string; blocked_reason: string }>
    return filas.map((f) => ({ syncId: f.sync_id ?? null, titulo: tituloDelPayload(f.payload), motivo: f.blocked_reason }))
  } catch {
    return [] // una base vieja sin `blocked_reason` no tiene nada bloqueado
  } finally {
    db.close()
  }
}

export async function leerDoctorDelPaquete(d: DependenciasDeDoctor): Promise<DatosDeDoctor> {
  let problemas = 0
  let avisos = 0
  const filas: FilaDeEstado[] = []
  const base = d.base
  const corto = (p: string) => acortarHome(p, d.homes)
  const ok = (etiqueta: string, detalle: string) => filas.push({ marca: 'ok', etiqueta, detalle })
  const aviso = (etiqueta: string, detalle: string) => { avisos++; filas.push({ marca: 'aviso', etiqueta, detalle }) }
  const nada = (etiqueta: string, detalle: string) => filas.push({ marca: 'nada', etiqueta, detalle })

  if (nodeAlcanza(d.versionDeNode)) ok('Node', d.versionDeNode)
  else {
    problemas++
    filas.push({ marca: 'falla', etiqueta: 'Node', detalle: `${d.versionDeNode} — needs ${NODE_MINIMO} or newer` })
  }
  nada('Home', acortarHome(d.home, [d.homeReal]))

  if (base.modo === 'daemon') ok('Nest', 'open — memory goes through it')
  else if (d.hayPunteroDeNest) aviso('Nest', 'closed — changes wait until it opens')
  else nada('Nest', 'not installed for this user')

  if (base.modo === 'daemon') ok('Memory', "through Nest's socket")
  else if (base.modo === 'propia' && base.nueva) nada('Memory', `${corto(base.path)} (created on first use)`)
  else ok('Memory', corto(base.path))

  if (d.llaveroDisponible) ok('Keyring', 'available')
  else aviso('Keyring', 'not available — encrypted cloud memory stays closed')

  const bloqueadas = leerBloqueadas(d)
  // Lo bloqueado es un aviso: con filas retenidas el resumen no puede decir «All good.».
  if (bloqueadas.length > 0) avisos++

  return {
    filas,
    // Adentro de un panel de Nest el HOME está redirigido a la carpeta de la cuenta: el paquete
    // busca la base donde no está y parece que no hubiera memoria.
    homeDeNest: !d.hayPunteroDeNest && d.home.includes('.raven-nest'),
    bloqueadas,
    problemas, avisos,
  }
}

/** «1 problem, 2 warnings», o `null` si está todo bien: la última línea del doctor. */
export function resumenDelDoctor(d: Pick<DatosDeDoctor, 'problemas' | 'avisos'>): string | null {
  const { problemas, avisos } = d
  const partes = [
    problemas && `${problemas} ${problemas === 1 ? 'problem' : 'problems'}`,
    avisos && `${avisos} ${avisos === 1 ? 'warning' : 'warnings'}`,
  ].filter(Boolean)
  return partes.length > 0 ? partes.join(', ') : null
}
