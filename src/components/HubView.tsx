import { useState, useEffect, useMemo, useCallback } from 'react'
import { WorkspaceTab } from '../types'
import HubGrid, { HubEntry, HubFilter, filterEntries } from './HubGrid'

const PAGE_SIZE = 12
const FILTER_STORAGE_KEY = 'nest-hub-filter'

function loadFilter(): HubFilter {
  const raw = localStorage.getItem(FILTER_STORAGE_KEY)
  if (raw === 'active' || raw === 'pinned') return raw
  return 'all'
}
function saveFilter(f: HubFilter) {
  localStorage.setItem(FILTER_STORAGE_KEY, f)
}

interface Props {
  tabs: WorkspaceTab[]
  activeTabId: string
  activePanes: Set<string>
  onJump: (tabId: string, paneId: string) => void
  onTogglePin: (tabId: string, paneId: string) => void
}

export default function HubView({ tabs, activeTabId, activePanes, onJump, onTogglePin }: Props) {
  const [filter, setFilter] = useState<HubFilter>(loadFilter)
  const [page, setPage] = useState(0)
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null)

  // Hub tabs own no terminals; exclude them so they don't contribute phantom entries.
  const sourceTabs = useMemo(() => tabs.filter(t => !t.isHub), [tabs])

  const entries = useMemo<HubEntry[]>(() =>
    sourceTabs.flatMap(t =>
      t.panes
        .filter(p => p.aiType !== 'browser')
        .map(p => ({
          pane: p,
          tabId: t.id,
          tabName: t.name,
          isActiveTab: t.id === activeTabId,
          busy: activePanes.has(p.id),
        }))
    ), [sourceTabs, activeTabId, activePanes])

  const filtered = useMemo(() => filterEntries(entries, filter), [entries, filter])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE)

  const changeFilter = useCallback((f: HubFilter) => {
    setFilter(f); setPage(0); saveFilter(f)
  }, [])

  // If the focused pane left the visible set (filter change, pane closed),
  // drop focus so Tab cycling restarts from the first tile.
  useEffect(() => {
    if (focusedPaneId && !visible.some(e => e.pane.id === focusedPaneId)) {
      setFocusedPaneId(null)
    }
  }, [visible, focusedPaneId])

  // Keyboard: Tab cycles tiles; Enter jumps to the focused pane's workspace.
  // In the overlay, Escape is handled centrally in App.tsx (capture phase) so
  // its priority lives in one place; the workspace variant has no Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        // If the user clicked into a tile's terminal, Tab belongs to the shell
        // (autocomplete) — don't hijack it for tile cycling.
        if (document.activeElement?.closest('.hub-tile-terminal')) return
        e.preventDefault()
        if (visible.length === 0) return
        const idx = visible.findIndex(en => en.pane.id === focusedPaneId)
        const next = e.shiftKey
          ? (idx - 1 + visible.length) % visible.length
          : (idx + 1) % visible.length
        setFocusedPaneId(visible[next].pane.id)
        return
      }
      if (e.key === 'Enter' && focusedPaneId) {
        const entry = visible.find(en => en.pane.id === focusedPaneId)
        // Only when the xterm itself isn't consuming Enter (i.e. the tile is
        // focused via Tab but the user hasn't clicked into the terminal).
        if (entry && !(document.activeElement?.closest('.hub-tile-terminal'))) {
          e.preventDefault()
          onJump(entry.tabId, entry.pane.id)
        }
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [visible, focusedPaneId, onJump])

  const counts = useMemo(() => ({
    all: entries.length,
    active: entries.filter(e => e.busy).length,
    pinned: entries.filter(e => e.pane.pinned).length,
  }), [entries])

  return (
    <div className="hub-view">
      <div className="hub-toolbar">
        <button className={`hub-chip${filter === 'all' ? ' on' : ''}`} onClick={() => changeFilter('all')}>
          Todas <span className="hub-chip-n">{counts.all}</span>
        </button>
        <button className={`hub-chip${filter === 'active' ? ' on' : ''}`} onClick={() => changeFilter('active')}>
          Activas <span className="hub-chip-n">{counts.active}</span>
        </button>
        <button className={`hub-chip${filter === 'pinned' ? ' on' : ''}`} onClick={() => changeFilter('pinned')}>
          Pineadas <span className="hub-chip-n">{counts.pinned}</span>
        </button>
        {pageCount > 1 && (
          <span className="hub-pager">
            <button className="hub-chip hub-pager-btn" disabled={clampedPage === 0} onClick={() => setPage(p => Math.max(0, p - 1))} aria-label="Página anterior">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <span className="hub-pager-label">{clampedPage + 1}/{pageCount}</span>
            <button className="hub-chip hub-pager-btn" disabled={clampedPage >= pageCount - 1} onClick={() => setPage(p => p + 1)} aria-label="Página siguiente">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </span>
        )}
      </div>
      <HubGrid
        entries={visible}
        focusedPaneId={focusedPaneId}
        onFocus={setFocusedPaneId}
        onJump={onJump}
        onTogglePin={onTogglePin}
      />
    </div>
  )
}
