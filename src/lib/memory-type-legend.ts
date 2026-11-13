// El color de un tipo no es un hex fijo — sale del tema de terminal del usuario, por ÍNDICE
// ANSI. Memories se ve como sus terminales, en vez de traer una paleta propia que puede
// chocar o no combinar con la que el usuario ya eligió. Sigue siendo la misma excepción justificada a "el color es estado"
// (RECETA-MIGRACION-UI.md): es leyenda categórica de 9 valores fijos, nunca ciclada — el
// orden en sí es el mecanismo de seguridad CVD (ver `MEMORY_TYPES_IN_LEGEND_ORDER`).
//
// `config`/`preference`/`session` comparten el índice 8 (brightBlack / gris de comentario):
// son los tres tipos que un agente casi nunca guarda y que no compiten entre sí por
// atención, así que no hace falta gastar un color categórico en distinguirlos — un gris
// apagado ya dice "metadata", no "cuál de los tres".
import { TEMA_NEST, subirContraste } from './terminal-themes'

/** El mismo hex que `--card` en `src/styles/global.css` — la superficie sobre la que se
 *  dibuja el swatch (la fila de la lista, la leyenda del grafo), que NO es el `background`
 *  de la terminal del tema. Ver el comentario de `subirContraste`. */
const FONDO_DE_LA_TARJETA = '#141414'

export type KnownMemoryType =
  | 'decision'
  | 'bugfix'
  | 'architecture'
  | 'discovery'
  | 'pattern'
  | 'config'
  | 'preference'
  | 'session'
  | 'handoff'

export interface MemoryTypeSwatch {
  label: string
  color: string
}

/** Índice ANSI por tipo. El color sale del tema de terminal del usuario: Memories se ve
 *  como sus terminales. */
export const MEMORY_TYPE_ANSI: Record<KnownMemoryType, number> = {
  decision: 4,
  bugfix: 1,
  architecture: 5,
  discovery: 6,
  pattern: 2,
  handoff: 3,
  config: 8,
  preference: 8,
  session: 8,
}

const LABEL: Record<KnownMemoryType, string> = {
  decision: 'Decision',
  bugfix: 'Bugfix',
  architecture: 'Architecture',
  discovery: 'Discovery',
  pattern: 'Pattern',
  handoff: 'Handoff',
  config: 'Config',
  preference: 'Preference',
  session: 'Session',
}

/** El orden fijo de la leyenda — nunca se ordena por otra cosa: el orden ES el mecanismo
 *  de seguridad CVD (ver el comentario de arriba). */
export const MEMORY_TYPES_IN_LEGEND_ORDER: KnownMemoryType[] = [
  'decision', 'bugfix', 'architecture', 'discovery', 'pattern', 'handoff', 'config', 'preference', 'session',
]

/**
 * `null` para un tipo que no está en la leyenda fija (uno futuro que el store todavía no
 * documenta) — el caller cae a un badge neutro con el nombre crudo, nunca a un color
 * inventado.
 *
 * `ansi` es la paleta de 16 colores del tema de terminal activo. Sin ella, o con una que
 * no trae los 16 (una paleta rota, o un caller que no la pasa), cae al tema
 * Nest — nunca a un hex suelto.
 */
export function memoryTypeSwatch(type: string, ansi?: readonly string[]): MemoryTypeSwatch | null {
  if (!Object.prototype.hasOwnProperty.call(MEMORY_TYPE_ANSI, type)) return null
  const k = type as KnownMemoryType
  const paleta = ansi && ansi.length >= 16 ? ansi : TEMA_NEST.ansi
  const crudo = paleta[MEMORY_TYPE_ANSI[k]]
  // El color crudo del tema puede no alcanzar 3:1
  // contra `--card` (el indice 8 — config/preference/session — falla en 4 temas
  // bundleados: Solarized 2.79, GitHub dark 2.18, Tokyo Night 2.06, Monokai 2.83). Subirlo
  // acá, en el único choke point que usan la lista Y el grafo, en vez de en cada caller.
  return { label: LABEL[k], color: subirContraste(crudo, FONDO_DE_LA_TARJETA) }
}
