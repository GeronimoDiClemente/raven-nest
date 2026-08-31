import { groupCounts, type PaneFilter, type PaneGroup } from '../lib/pane-filter'
import { AI_CONFIG, type PaneNode } from '../types'

// Los tres tipos reales leen su label de AI_CONFIG (única fuente del nombre
// de cada tipo de pane); solo el grupo sintético 'agents' necesita string
// propio — renombrar un label en AI_CONFIG no debe dejar chips stale.
export const GROUP_LABELS: Record<PaneGroup, string> = {
  agents: 'Agents',
  editor: AI_CONFIG.editor.label,
  terminal: AI_CONFIG.terminal.label,
  browser: AI_CONFIG.browser.label,
}

interface Props {
  panes: readonly PaneNode[]
  filter: PaneFilter
  onChange: (filter: PaneFilter) => void
}

// Chips de filtro por tipo de pane (workspace/Hub). Solo aparecen cuando el
// workspace mezcla más de un grupo — con un solo grupo no hay nada que
// separar. Click en un grupo lo aísla; click en el activo (o en All) vuelve
// a mostrar todo. Reusa el estilo hub-chip del Hub-overlay.
export default function PaneFilterChips({ panes, filter, onChange }: Props) {
  const counts = groupCounts(panes)
  if (counts.length < 2) return null
  return (
    <div className="pane-filter-chips">
      <button
        className={`hub-chip${filter === 'all' ? ' on' : ''}`}
        onClick={() => onChange('all')}
      >
        All <span className="hub-chip-n">{panes.length}</span>
      </button>
      {counts.map(({ group, count }) => (
        <button
          key={group}
          className={`hub-chip${filter === group ? ' on' : ''}`}
          onClick={() => onChange(filter === group ? 'all' : group)}
        >
          {GROUP_LABELS[group]} <span className="hub-chip-n">{count}</span>
        </button>
      ))}
    </div>
  )
}
