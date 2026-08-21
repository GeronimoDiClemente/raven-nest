/**
 * Ancho de pane (px) a partir del cual el minimap aporta más de lo que estorba.
 *
 * Nest no es un IDE de una sola ventana: es una grilla de panes. El minimap se
 * come ~80px de ancho útil, así que en un pane angosto renderiza texto
 * microscópico y roba espacio al código. Con este umbral aparece solo cuando
 * hay lugar — pane único, dos en paralelo, o al agrandarlo con el zoom de Nest —
 * y se esconde solo cuando el pane se angosta.
 */
export const MINIMAP_MIN_PANE_WIDTH = 720

export function minimapEnabledFor(paneWidth: number): boolean {
  return paneWidth >= MINIMAP_MIN_PANE_WIDTH
}
