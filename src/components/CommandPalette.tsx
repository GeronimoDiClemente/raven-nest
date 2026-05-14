import { useState, useEffect, useRef, useCallback } from 'react'
import { WorkspaceTab, Workspace, Snippet, ConversationMeta, AI_CONFIG } from '../types'

interface PaletteItem {
  id: string
  section: 'actions' | 'tabs' | 'workspaces' | 'snippets' | 'history'
  label: string
  sublabel?: string
  keywords?: string
  action: () => void
}

interface Props {
  onClose: () => void
  tabs: WorkspaceTab[]
  activeTabId: string
  focusedPaneId: string | null
  broadcastMode: boolean
  onTabSelect: (id: string) => void
  onWorkspaceLoad: (ws: Workspace) => void
  onSnippetSend: (content: string) => void
  onSnippetBroadcast: (content: string) => void
  onHistoryOpen: () => void
  onNewTab: () => void
  onNewPane: () => void
  onBroadcastToggle: () => void
}

function score(item: PaletteItem, query: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const label = item.label.toLowerCase()
  const sub = (item.sublabel ?? '').toLowerCase()
  const kw = (item.keywords ?? '').toLowerCase()
  if (label === q) return 100
  if (label.startsWith(q)) return 80
  if (label.includes(q)) return 60
  if (sub.includes(q) || kw.includes(q)) return 40
  // fuzzy: every char in query appears in order in label
  let i = 0
  for (const c of q) {
    const idx = label.indexOf(c, i)
    if (idx === -1) return 0
    i = idx + 1
  }
  return 20
}

const SECTION_LABELS: Record<PaletteItem['section'], string> = {
  actions: 'Acciones',
  tabs: 'Tabs',
  workspaces: 'Workspaces',
  snippets: 'Snippets',
  history: 'Historial',
}

export default function CommandPalette({
  onClose, tabs, activeTabId, focusedPaneId, broadcastMode,
  onTabSelect, onWorkspaceLoad, onSnippetSend, onSnippetBroadcast,
  onHistoryOpen, onNewTab, onNewPane, onBroadcastToggle,
}: Props) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [conversations, setConversations] = useState<ConversationMeta[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    Promise.all([
      window.workspaces.list(),
      window.snippets.list(),
      window.conversations.list(),
    ]).then(([ws, sn, cv]) => {
      setWorkspaces(ws)
      setSnippets(sn)
      setConversations(cv)
    })
  }, [])

  const buildItems = useCallback((): PaletteItem[] => {
    const items: PaletteItem[] = []

    // Static actions
    items.push({
      id: 'action-new-tab', section: 'actions',
      label: 'New tab', sublabel: 'Create a new workspace',
      keywords: 'tab workspace new',
      action: () => { onNewTab(); onClose() },
    })
    items.push({
      id: 'action-new-pane', section: 'actions',
      label: 'New terminal', sublabel: 'Add a terminal to the current layout',
      keywords: 'pane terminal new',
      action: () => { onNewPane(); onClose() },
    })
    items.push({
      id: 'action-broadcast', section: 'actions',
      label: broadcastMode ? 'Disable broadcast' : 'Enable broadcast',
      sublabel: broadcastMode ? 'Stop sending to all terminals' : 'Send to all terminals',
      keywords: 'broadcast all terminals',
      action: () => { onBroadcastToggle(); onClose() },
    })
    items.push({
      id: 'action-history', section: 'actions',
      label: 'View history', sublabel: 'Open the saved conversations panel',
      keywords: 'history conversations',
      action: () => { onHistoryOpen(); onClose() },
    })

    // Tabs
    tabs.forEach(tab => {
      if (tab.id === activeTabId) return
      const paneCount = tab.panes.length
      items.push({
        id: `tab-${tab.id}`, section: 'tabs',
        label: tab.name,
        sublabel: `${paneCount} terminal${paneCount !== 1 ? 'es' : ''}`,
        keywords: 'tab workspace ir',
        action: () => { onTabSelect(tab.id); onClose() },
      })
    })

    // Workspaces
    workspaces.forEach(ws => {
      items.push({
        id: `ws-${ws.id}`, section: 'workspaces',
        label: ws.name,
        sublabel: `${ws.layout.rows}×${ws.layout.cols}`,
        keywords: 'workspace cargar layout',
        action: () => { onWorkspaceLoad(ws); onClose() },
      })
    })

    // Snippets
    snippets.forEach(sn => {
      items.push({
        id: `sn-${sn.id}`, section: 'snippets',
        label: sn.name,
        sublabel: sn.content.slice(0, 60) + (sn.content.length > 60 ? '…' : ''),
        keywords: 'snippet enviar comando',
        action: () => {
          if (broadcastMode) onSnippetBroadcast(sn.content)
          else onSnippetSend(sn.content)
          onClose()
        },
      })
    })

    // Conversations history (last 10)
    conversations.slice(0, 10).forEach(cv => {
      const label = AI_CONFIG[cv.aiType as keyof typeof AI_CONFIG]?.label ?? cv.aiType
      items.push({
        id: `cv-${cv.id}`, section: 'history',
        label: cv.preview.slice(0, 50) || 'No preview',
        sublabel: `${label} · ${cv.accountName} · ${new Date(cv.timestamp).toLocaleDateString()}`,
        keywords: 'historial conversacion',
        action: () => { onHistoryOpen(); onClose() },
      })
    })

    return items
  }, [tabs, activeTabId, workspaces, snippets, conversations, broadcastMode,
      onNewTab, onNewPane, onBroadcastToggle, onHistoryOpen,
      onTabSelect, onWorkspaceLoad, onSnippetSend, onSnippetBroadcast, onClose])

  const filtered = buildItems()
    .map(item => ({ item, s: score(item, query) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.item)

  const sectionMap = new Map<PaletteItem['section'], PaletteItem[]>()
  const sectionOrder: PaletteItem['section'][] = []
  filtered.forEach(item => {
    if (!sectionMap.has(item.section)) {
      sectionMap.set(item.section, [])
      sectionOrder.push(item.section)
    }
    sectionMap.get(item.section)!.push(item)
  })

  const clampedIdx = Math.min(selectedIdx, filtered.length - 1)

  useEffect(() => { setSelectedIdx(0) }, [query])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${clampedIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [clampedIdx])

  const execute = (idx: number) => {
    const item = filtered[idx]
    if (item) item.action()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      execute(clampedIdx)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  let globalIdx = 0

  return (
    <div className="cmd-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmd-panel">
        <div className="cmd-input-row">
          <svg className="cmd-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search actions, workspaces, snippets…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
          />
          <kbd className="cmd-esc-hint">esc</kbd>
        </div>

        <div className="cmd-results" ref={listRef}>
          {filtered.length === 0 && (
            <p className="cmd-empty">No results for "{query}"</p>
          )}
          {sectionOrder.map(sectionKey => {
            const sectionItems = sectionMap.get(sectionKey)!
            return (
              <div key={sectionKey} className="cmd-section">
                <div className="cmd-section-label">{SECTION_LABELS[sectionKey]}</div>
                {sectionItems.map(item => {
                  const idx = globalIdx++
                  return (
                    <div
                      key={item.id}
                      data-idx={idx}
                      className={`cmd-item${idx === clampedIdx ? ' selected' : ''}`}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      onMouseDown={(e) => { e.preventDefault(); execute(idx) }}
                    >
                      <span className="cmd-item-label">{item.label}</span>
                      {item.sublabel && <span className="cmd-item-sub">{item.sublabel}</span>}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        <div className="cmd-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> execute</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
