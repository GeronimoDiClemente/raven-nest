import type { AIType, PaneNode } from '../types'
import { isAgentPane } from './broadcast'

// Filtro de vista por tipo de pane (workspace y Hub): ver solo agentes de
// IA, solo editores, etc., sin tener todo mezclado. Es estado de VISTA —
// transitorio, default 'all', per-tab, sin persistencia: nunca muta
// `tab.panes` ni `layoutId`/`splitRatios` persistidos. El render deriva los
// panes visibles y un layout para ese conteo; al volver a 'all' el layout
// real reaparece intacto. Los panes filtrados se DESMONTAN — el mismo ciclo
// ya blindado del cambio de workspace tab (PTY con replay, stash de buffers
// dirty del editor, browser re-creado con su URL).

export type PaneGroup = 'agents' | 'editor' | 'terminal' | 'browser'
export type PaneFilter = PaneGroup | 'all'

// El orden define el orden de los chips en la UI.
const GROUP_ORDER: readonly PaneGroup[] = ['agents', 'editor', 'terminal', 'browser']

export function paneGroup(aiType: AIType): PaneGroup {
  if (aiType === 'editor') return 'editor'
  if (aiType === 'browser') return 'browser'
  // Misma noción de "agente" que el broadcast: custom ES agente, terminal NO.
  return isAgentPane(aiType) ? 'agents' : 'terminal'
}

export function groupCounts(panes: readonly PaneNode[]): Array<{ group: PaneGroup; count: number }> {
  const counts = new Map<PaneGroup, number>()
  for (const p of panes) {
    const g = paneGroup(p.aiType)
    counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  return GROUP_ORDER.filter(g => counts.has(g)).map(g => ({ group: g, count: counts.get(g)! }))
}

export interface FilteredPanes {
  panes: PaneNode[]
  // false ⇒ se muestra todo (filtro 'all' o fallback): el caller usa el
  // layout/splitRatios persistidos del tab en vez de derivar uno.
  active: boolean
}

/**
 * Si algún pane NUEVO (id ausente en prevIds) no matchea el filtro activo:
 * un pane recién creado invisible parece un bug, no un filtro — el caller
 * resetea la vista a 'all'.
 */
export function newPaneBreaksFilter(
  prevIds: ReadonlySet<string>,
  panes: readonly PaneNode[],
  filter: PaneFilter,
): boolean {
  if (filter === 'all') return false
  return panes.some(p => !prevIds.has(p.id) && paneGroup(p.aiType) !== filter)
}

export function applyPaneFilter(panes: PaneNode[], filter: PaneFilter): FilteredPanes {
  if (filter === 'all') return { panes, active: false }
  const visible = panes.filter(p => paneGroup(p.aiType) === filter)
  // Grupo vacío (p.ej. se cerró el último editor con el filtro puesto): un
  // workspace vacío por filtro es un workspace roto — cae a mostrar todo.
  if (visible.length === 0) return { panes, active: false }
  return { panes: visible, active: true }
}
