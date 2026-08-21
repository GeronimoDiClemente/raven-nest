import { AI_CONFIG } from '../types'
import type { PaneNode } from '../types'

/**
 * Color con el que se identifica un pane fuera de su propio marco (bullet del
 * filtro, lista de panes del sidebar, dot del tile del Hub).
 *
 * `borderColor: 'transparent'` es el marcador de "sin borde", no un color: se
 * trata como ausencia para caer al color del agente. Con `??` a secas el pane
 * quedaba invisible en el sidebar y en el Hub al apagarle el borde.
 */
export function paneAccentColor(pane: Pick<PaneNode, 'borderColor' | 'customColor' | 'aiType'>): string {
  const chosen = pane.borderColor && pane.borderColor !== 'transparent' ? pane.borderColor : undefined
  return chosen ?? pane.customColor ?? AI_CONFIG[pane.aiType]?.color ?? '#888888'
}
