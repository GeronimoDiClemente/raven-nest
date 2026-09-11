// Spec 2026-09-11 §1 (pantalla de Memories legible): "el tipo se distingue sin leer".
// Son siete valores fijos (electron/memory-protocol.ts's ObservationType, menos
// `session`/`handoff` que son internos y rara vez llegan a esta lista), así que
// califican como leyenda categórica — la excepción justificada a la regla de que el
// color es estado (RECETA-MIGRACION-UI.md, "un literal de color cromático no se
// convierte automáticamente").
//
// Paleta: los primeros 7 slots del tema categórico validado de la skill dataviz
// (blue/orange/aqua/yellow/magenta/green/violet), en su orden fijo — nunca ciclado,
// es lo que hace que el orden en sí sea el mecanismo de seguridad CVD. Solo el valor
// "dark": Nest no tiene tema claro (ver src/components/ui/button.tsx). Elegidos para
// NO coincidir con --ok/--warn/--destructive (#4ade80/#e3b341/#ff6568) — misma familia
// perceptual, tonos distintos, para que un tipo no se lea como severidad. Contraste
// verificado >=3:1 contra --card (#141414) para los siete: 3.73–6.00 (script de la
// skill dataviz), muy por encima del umbral 3:1 de e2e/04-contraste.spec.ts.
export type KnownMemoryType =
  | 'decision'
  | 'bugfix'
  | 'architecture'
  | 'discovery'
  | 'pattern'
  | 'config'
  | 'preference'

export interface MemoryTypeSwatch {
  label: string
  color: string
}

const MEMORY_TYPE_SWATCHES: Record<KnownMemoryType, MemoryTypeSwatch> = {
  decision: { label: 'Decision', color: '#3987e5' },
  bugfix: { label: 'Bugfix', color: '#d95926' },
  architecture: { label: 'Architecture', color: '#199e70' },
  discovery: { label: 'Discovery', color: '#c98500' },
  pattern: { label: 'Pattern', color: '#d55181' },
  config: { label: 'Config', color: '#008300' },
  preference: { label: 'Preference', color: '#9085e9' },
}

/** El orden fijo de la leyenda — el mismo en el que están declarados los swatches, que es
 *  el orden del tema categórico validado. Nunca se ordena por otra cosa: el orden ES el
 *  mecanismo de seguridad CVD (ver el comentario de arriba). */
export const MEMORY_TYPES_IN_LEGEND_ORDER = Object.keys(MEMORY_TYPE_SWATCHES) as KnownMemoryType[]

/**
 * `null` para un tipo que no está en la leyenda fija (`session`/`handoff`, o uno
 * futuro que el store todavía no documenta) — el caller cae a un badge neutro con el
 * nombre crudo, nunca a un color inventado.
 */
export function memoryTypeSwatch(type: string): MemoryTypeSwatch | null {
  return Object.prototype.hasOwnProperty.call(MEMORY_TYPE_SWATCHES, type)
    ? MEMORY_TYPE_SWATCHES[type as KnownMemoryType]
    : null
}
