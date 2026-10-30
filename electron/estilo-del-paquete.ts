// La apariencia de `npx @nestmux/memory` en la terminal.
//
// Sólo los 16 colores ANSI básicos: cada terminal los traduce a su tema, igual que la app colorea
// los tipos de memoria con el índice ANSI del tema del usuario. Sin color cuando la salida no es
// una terminal o el usuario lo pide con NO_COLOR (https://no-color.org).
import type { ObservationType } from './memory-protocol'

export interface Estilo {
  readonly color: boolean
  negrita(s: string): string
  tenue(s: string): string
  ok(s: string): string
  aviso(s: string): string
  falla(s: string): string
  acento(s: string): string
  deGrupo(g: GrupoDeTipo, s: string): string
}

export function decidirColor(env: NodeJS.ProcessEnv, esTerminal: boolean): boolean {
  if (env.NO_COLOR) return false
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== '0'
  if (env.TERM === 'dumb') return false
  return esTerminal
}

const sgr = (codigo: string) => (s: string) => `\x1b[${codigo}m${s}\x1b[0m`

export function crearEstilo(color: boolean): Estilo {
  const pintar = (codigo: string) => (color ? sgr(codigo) : (s: string) => s)
  const colorDeGrupo: Record<GrupoDeTipo, string> = {
    decisions: '34', fixes: '33', conventions: '35', discoveries: '32', sessions: '90',
  }
  return {
    color,
    negrita: pintar('1'),
    tenue: pintar('90'),
    ok: pintar('32'),
    aviso: pintar('33'),
    falla: pintar('31'),
    acento: pintar('1;32'),
    deGrupo: (g, s) => pintar(colorDeGrupo[g])(s),
  }
}

/** `> nest memory_ / status`: la línea del logo de Nest, como encabezado de cada comando. */
export function marca(e: Estilo, subcomando?: string, detalle?: string): string {
  const cola = [subcomando && `/ ${subcomando}`, detalle].filter(Boolean).join(' · ')
  return `${e.negrita('> nest memory')}${e.acento('_')}${cola ? ` ${e.tenue(cola)}` : ''}`
}

export const marcas = {
  ok: (e: Estilo) => e.ok('✓'),
  aviso: (e: Estilo) => e.aviso('!'),
  falla: (e: Estilo) => e.falla('✗'),
  pendiente: (e: Estilo) => e.aviso('●'),
  nada: (e: Estilo) => e.tenue('·'),
}

/** Una fila `marca  Etiqueta  detalle` con la etiqueta en columna fija. */
export function fila(marcaPintada: string, etiqueta: string, detalle: string, ancho = 13): string {
  return `  ${marcaPintada}  ${etiqueta.padEnd(ancho)} ${detalle}`
}

/** `~` en lugar del home y los ids largos (uuid de la cuenta) cortados: una ruta que entre en una línea. */
export function acortarHome(path: string, homes: string[]): string {
  let corta = path
  for (const h of homes) {
    if (h && (path === h || path.startsWith(`${h}/`) || path.startsWith(`${h}\\`))) {
      corta = `~${path.slice(h.length)}`
      break
    }
  }
  return corta.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (id) => `${id.slice(0, 8)}…`)
}

export function recortar(s: string, max: number): string {
  const linea = s.replace(/\s+/g, ' ').trim()
  return linea.length <= max ? linea : `${linea.slice(0, max - 1).trimEnd()}…`
}

/** «2h», «3d», «5mo»: la antigüedad de una memoria, en el ancho de una columna. */
export function hace(ms: number, ahora: number): string {
  const min = Math.max(0, Math.floor((ahora - ms) / 60_000))
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d`
  const meses = Math.floor(d / 30)
  return meses < 12 ? `${meses}mo` : `${Math.floor(meses / 12)}y`
}

export type GrupoDeTipo = 'decisions' | 'fixes' | 'conventions' | 'discoveries' | 'sessions'

export const ORDEN_DE_GRUPOS: GrupoDeTipo[] = ['decisions', 'fixes', 'conventions', 'discoveries', 'sessions']

const GRUPO_POR_TIPO: Record<ObservationType, GrupoDeTipo> = {
  decision: 'decisions',
  bugfix: 'fixes',
  architecture: 'conventions',
  pattern: 'conventions',
  config: 'conventions',
  preference: 'conventions',
  discovery: 'discoveries',
  session: 'sessions',
  handoff: 'sessions',
}

export function grupoDeTipo(tipo: string): GrupoDeTipo {
  return GRUPO_POR_TIPO[tipo as ObservationType] ?? 'discoveries'
}

const ETIQUETA_DE_TIPO: Record<GrupoDeTipo, string> = {
  decisions: 'decision', fixes: 'fix', conventions: 'convention', discoveries: 'discovery', sessions: 'session',
}

/** La etiqueta singular de una memoria (`fix`, `decision`…), pintada con el color de su grupo. */
export function etiquetaDeTipo(e: Estilo, tipo: string, ancho = 10): string {
  const g = grupoDeTipo(tipo)
  return e.deGrupo(g, ETIQUETA_DE_TIPO[g].padEnd(ancho))
}

/**
 * La barra proporcional por grupo y su leyenda. Cada grupo con al menos una memoria ocupa al
 * menos un bloque, para que no desaparezca de la barra.
 */
export function barraDeGrupos(e: Estilo, conteos: Partial<Record<GrupoDeTipo, number>>, ancho = 48): string[] {
  const presentes = ORDEN_DE_GRUPOS.filter((g) => (conteos[g] ?? 0) > 0)
  const total = presentes.reduce((n, g) => n + (conteos[g] ?? 0), 0)
  if (total === 0) return []
  const bloques = presentes.map((g) => Math.max(1, Math.round(((conteos[g] ?? 0) / total) * ancho)))
  // El redondeo puede pasarse o quedarse corto: el ajuste va al grupo más grande.
  const mayor = bloques.indexOf(Math.max(...bloques))
  bloques[mayor] += ancho - bloques.reduce((a, b) => a + b, 0)
  const barra = presentes.map((g, i) => e.deGrupo(g, '█'.repeat(bloques[i]))).join('')
  const leyenda = presentes.map((g) => `${e.deGrupo(g, '■')} ${g} ${conteos[g]}`).join('   ')
  return [`  ${barra}`, `  ${leyenda}`]
}
