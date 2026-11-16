// El contrato de los íconos. Una sola escala de tamaños y UN SOLO grosor de trazo.
//
// **El problema que resuelve:** el grosor que el ojo ve no es el `strokeWidth` que dice el
// markup, sino `strokeWidth × (width / viewBox)`. Con viewBox de 12, 14 y 16 mezclados, dos
// íconos declarados los dos en 16px pintan trazos visiblemente distintos (1.05, 1.06, 1.13,
// 1.14 px conviviendo). Nada está mal; todo está apenas distinto, que es exactamente el
// mecanismo por el que una interfaz "parece improvisada".
//
// **Cómo se arregla de raíz:** `nonScalingStroke` le pone `vector-effect: non-scaling-stroke`
// al path, con lo cual el trazo se pinta en píxeles de dispositivo y deja de depender de la
// escala del viewBox. Con eso, un solo `strokeWidth` da el mismo grosor en cualquier tamaño.
// Se declara una vez en `LucideProvider` (src/main.tsx) y lo hereda todo: un ícono que
// alguien agregue mañana sin leer esto ya sale bien.
//
// `nonScalingStroke`, no `absoluteStrokeWidth`: el segundo hace la misma cuenta a mano y
// está **deprecado** en lucide-react 1.43 (ver el tipo `LucideConfig`).

/**
 * Grosor del trazo, en píxeles de pantalla, para TODOS los íconos de la app.
 *
 * 1.25 es el centro del grupo de grosores que domina la app (1.14 / 1.22 / 1.3): elegirlo hace
 * que la mayoría de la app no cambie de peso visual, y que lo que cambie sea lo desviado.
 */
export const ICON_STROKE = 1.25

/**
 * Los tres tamaños. Se corresponden con la escala de filas vigente (24 / 28 / 32 / 36):
 * un ícono `sm` vive en una fila de 24, `md` en una de 28, `lg` en una de 32 o 36.
 *
 * Tres alcanzan: los de 3 a 8 px no son íconos sino puntos y adornos, que no pasan por acá.
 */
export const ICON_SIZE = {
  sm: 12,
  md: 14,
  lg: 16,
} as const

export type IconSizeName = keyof typeof ICON_SIZE

/** Los valores permitidos, para que un test pueda afirmar sobre ellos. */
export const ICON_SIZES: readonly number[] = Object.values(ICON_SIZE)
