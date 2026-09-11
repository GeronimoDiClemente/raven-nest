// El contrato de los íconos. Una sola escala de tamaños y UN SOLO grosor de trazo.
//
// **El problema que resuelve, medido el 2026-09-11 antes de tocar nada:** la app tenía 148
// SVG de UI dibujados a mano en 39 archivos, con **28 grosores de trazo efectivos
// distintos** en pantalla. No 28 elegidos: 28 accidentales. El grosor que el ojo ve no es el
// `strokeWidth` que dice el markup, sino `strokeWidth × (width / viewBox)`, y los viewBox
// estaban en 12, 14 y 16 mezclados — así que dos íconos declarados los dos en 16px podían
// pintar trazos visiblemente distintos. De ahí salían valores como 1.05, 1.06, 1.13 y 1.14
// px conviviendo, separados por centésimas de pixel.
//
// Peor: **13 de 27 archivos mezclaban varios grosores adentro del mismo archivo**.
// TeamsWorkspace tenía once en una sola pantalla. Nada estaba mal; todo estaba apenas
// distinto, que es exactamente el mecanismo por el que una interfaz "parece improvisada".
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
 * 1.25 es el centro del grupo que ya dominaba de hecho (1.14 / 1.22 / 1.3 juntaban 68 de los
 * 148 usos): elegirlo hace que la mayoría de la app no cambie de peso visual, y que lo que
 * cambie sea lo que estaba desviado.
 */
export const ICON_STROKE = 1.25

/**
 * Los tres tamaños. Se corresponden con la escala de filas vigente (24 / 28 / 32 / 36):
 * un ícono `sm` vive en una fila de 24, `md` en una de 28, `lg` en una de 32 o 36.
 *
 * Antes había **13 anchos distintos** (3, 5, 7, 8, 10, 11, 12, 13, 14, 15, 16, 18…). Tres
 * alcanzan: los de 3 a 8 px no eran íconos sino puntos y adornos, que no pasan por acá.
 */
export const ICON_SIZE = {
  sm: 12,
  md: 14,
  lg: 16,
} as const

export type IconSizeName = keyof typeof ICON_SIZE

/** Los valores permitidos, para que un test pueda afirmar sobre ellos. */
export const ICON_SIZES: readonly number[] = Object.values(ICON_SIZE)
