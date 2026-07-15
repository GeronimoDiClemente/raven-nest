import { PaneNode } from '../types'
import HubTile from './HubTile'

export interface HubEntry {
  pane: PaneNode
  tabId: string
  tabName: string
  isActiveTab: boolean
  busy: boolean
}

// Filtros transversales del Hub. NO hay filtro por-workspace: filtrar a un solo
// workspace mostraría lo mismo que ir a su pestaña, así que no aporta nada.
export type HubFilter = 'all' | 'active' | 'pinned'

export function filterEntries(entries: HubEntry[], filter: HubFilter): HubEntry[] {
  if (filter === 'active') return entries.filter(e => e.busy)
  if (filter === 'pinned') return entries.filter(e => e.pane.pinned)
  return entries  // 'all'
}

interface Props {
  entries: HubEntry[]
  focusedPaneId: string | null
  onFocus: (paneId: string) => void
  onJump: (tabId: string, paneId: string) => void
  onTogglePin: (tabId: string, paneId: string) => void
}

export default function HubGrid({ entries, focusedPaneId, onFocus, onJump, onTogglePin }: Props) {
  if (entries.length === 0) {
    return <div className="hub-empty">No hay terminales para este filtro</div>
  }
  return (
    <div className="hub-grid">
      {entries.map(e => (
        <HubTile
          key={e.pane.id}
          entry={e}
          focused={focusedPaneId === e.pane.id}
          onFocus={onFocus}
          onJump={onJump}
          onTogglePin={onTogglePin}
        />
      ))}
    </div>
  )
}
