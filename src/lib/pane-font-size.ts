/** Límites del tamaño de fuente de un pane, y el valor por defecto. */
export const FONT_SIZE_MIN = 9
export const FONT_SIZE_MAX = 20
export const FONT_SIZE_DEFAULT = 13

/**
 * Siguiente tamaño de fuente al aplicar un paso del atajo, con clamp.
 *
 * El tamaño es POR PANE con fallback al global: agrandar la letra de una
 * terminal no debe agrandar la de todas. `current` es lo que ese pane muestra
 * hoy (su valor propio o el global heredado).
 */
export function nextFontSize(current: number, step: number): number {
  return Math.min(Math.max(current + step, FONT_SIZE_MIN), FONT_SIZE_MAX)
}
