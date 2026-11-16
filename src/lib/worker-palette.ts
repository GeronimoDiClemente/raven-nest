// El color de un worker no es un hex fijo — sale del tema de terminal del usuario, por ÍNDICE
// ANSI, igual que el de un tipo de memoria (memory-type-legend.ts). Es una excepción justificada
// a "el color es estado" (spec 2026-11-12-orquestacion-panes §5, RECETA-MIGRACION-UI.md): es
// leyenda categórica — identifica QUÉ worker es, para cruzar su pane con lo que reporta el
// coordinador — y nunca severidad. El estado del worker (trabajando / pregunta / bloqueado /
// listo) va con `--ok`/`--warn`/`--destructive`, no con este color. El coordinador queda neutro.
//
// Índices 4, 2, 5, 3 (azul, verde, magenta, amarillo): se evita el 1 (rojo), que se lee como
// error. Son 4 porque un coordinador tiene como mucho 4 workers vivos (§6.5).
import { TEMA_NEST, subirContraste } from './terminal-themes'

/** El mismo hex que `--card` en `src/styles/global.css`, igual que en memory-type-legend.ts:
 *  el borde y el punto del worker se dibujan sobre la superficie de la app, no sobre el
 *  `background` de la terminal del tema. */
const FONDO_DE_LA_TARJETA = '#141414'

export const WORKER_ANSI: readonly [number, number, number, number] = [4, 2, 5, 3]

/**
 * `ansi` es la paleta de 16 colores del tema de terminal activo. Sin ella, o con una que no
 * trae los 16, cae al tema Nest — nunca a un hex suelto. Un `colorIndex` fuera de 0..3 cicla.
 */
export function workerSwatch(colorIndex: number, ansi?: readonly string[]): string {
  const paleta = ansi && ansi.length >= 16 ? ansi : TEMA_NEST.ansi
  const n = WORKER_ANSI.length
  const k = Number.isFinite(colorIndex) ? Math.trunc(colorIndex) : 0
  const i = ((k % n) + n) % n
  return subirContraste(paleta[WORKER_ANSI[i]], FONDO_DE_LA_TARJETA)
}
