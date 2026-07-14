import { useState, useEffect, useMemo, useCallback } from 'react'
import { WorkspaceTab } from '../types'
import HubGrid, { HubEntry, HubFilter, filterEntries } from './HubGrid'
import { formatBinding } from '../lib/keybindings'

const PAGE_SIZE = 12
const FILTER_STORAGE_KEY = 'nest-hub-filter'

function loadFilter(): HubFilter {
  const raw = localStorage.getItem(FILTER_STORAGE_KEY)
  if (raw === 'active' || raw === 'pinned') return raw
  if (raw?.startsWith('tab:')) return { tabId: raw.slice(4) }
  return 'all'
}

function saveFilter(f: HubFilter) {
  localStorage.setItem(FILTER_STORAGE_KEY, typeof f === 'string' ? f : `tab:${f.tabId}`)
}

interface Props {
  tabs: WorkspaceTab[]
  activeTabId: string
  busyPanes: Set<string>
  onClose: () => void
  onJump: (tabId: string, paneId: string) => void
  onTogglePin: (tabId: string, paneId: string) => void
}

export default function HubOverlay({ tabs, activeTabId, busyPanes, onClose, onJump, onTogglePin }: Props) {
  const [filter, setFilter] = useState<HubFilter>(loadFilter)
  const [page, setPage] = useState(0)
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null)

  const entries = useMemo<HubEntry[]>(() =>
    tabs.flatMap(t =>
      t.panes
        .filter(p => p.aiType !== 'browser')
        .map(p => ({
          pane: p,
          tabId: t.id,
          tabName: t.name,
          isActiveTab: t.id === activeTabId,
          busy: busyPanes.has(p.id),
        }))
    ), [tabs, activeTabId, busyPanes])

  const filtered = useMemo(() => filterEntries(entries, filter), [entries, filter])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE)

  const changeFilter = useCallback((f: HubFilter) => {
    setFilter(f)
    setPage(0)
    saveFilter(f)
  }, [])

  // If the focused pane left the visible set (filter change, pane closed),
  // drop focus so Tab cycling restarts from the first tile.
  useEffect(() => {
    if (focusedPaneId && !visible.some(e => e.pane.id === focusedPaneId)) {
      setFocusedPaneId(null)
    }
  }, [visible, focusedPaneId])

  // Keyboard: Tab cycles tiles; Enter jumps to the focused pane's workspace.
  // Escape is handled centrally in App.tsx (capture phase) so overlay
  // priority lives in one place.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
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

  const filterIs = (f: HubFilter) =>
    typeof f === 'string' ? filter === f : typeof filter !== 'string' && filter.tabId === f.tabId

  return (
    <div className="hub-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="hub-panel">
        <div className="hub-title">
          <span>Hub — terminales activas</span>
          <span className="hub-title-hint">
            Esc volver · Tab siguiente · Enter ir al workspace · {formatBinding('Meta+Shift+O')} toggle
          </span>
        </div>
        <div className="hub-toolbar">
          <button className={`hub-chip${filterIs('all') ? ' on' : ''}`} onClick={() => changeFilter('all')}>
            Todas <span className="hub-chip-n">{counts.all}</span>
          </button>
          <button className={`hub-chip${filterIs('active') ? ' on' : ''}`} onClick={() => changeFilter('active')}>
            Activas <span className="hub-chip-n">{counts.active}</span>
          </button>
          <button className={`hub-chip${filterIs('pinned') ? ' on' : ''}`} onClick={() => changeFilter('pinned')}>
            Pineadas <span className="hub-chip-n">{counts.pinned}</span>
          </button>
          <span className="hub-toolbar-sep" />
          {tabs.map(t => (
            <button
              key={t.id}
              className={`hub-chip${filterIs({ tabId: t.id }) ? ' on' : ''}`}
              onClick={() => changeFilter({ tabId: t.id })}
            >
              {t.name}
            </button>
          ))}
          {pageCount > 1 && (
            <span className="hub-pager">
              <button className="hub-chip" disabled={clampedPage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>‹</button>
              <span className="hub-pager-label">{clampedPage + 1}/{pageCount}</span>
              <button className="hub-chip" disabled={clampedPage >= pageCount - 1} onClick={() => setPage(p => p + 1)}>›</button>
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
    </div>
  )
}
