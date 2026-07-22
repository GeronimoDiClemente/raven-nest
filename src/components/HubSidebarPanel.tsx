import { useState } from 'react'

export interface HubWorkspace {
  id: string
  name: string
  accentColor?: string
  terminals: { id: string; label: string; color: string }[]
}

interface Props {
  workspaces: HubWorkspace[]
  expanded: boolean
  onSelectWorkspace: (tabId: string) => void
  onJumpToPane: (tabId: string, paneId: string) => void
  onNewWorkspace: () => void
  onAddTerminal: (tabId: string) => void
}

/**
 * Hub-tab sidebar: browse the terminals across every open workspace and focus
 * one *within the Hub* (the Hub is a filterable view, not a launcher — clicks
 * focus a tile, they don't navigate). Styled on the existing WorktreesSection
 * (.wt-*) + sidebar-item tokens so it matches the rest of the sidebar. Pure.
 */
export default function HubSidebarPanel({
  workspaces, expanded, onSelectWorkspace, onJumpToPane, onNewWorkspace, onAddTerminal,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // Collapsed sidebar (44px): show only the New-workspace icon row, matching
  // the collapsed non-Hub rail (bare icons, no labelled tree).
  const newWorkspaceRow = (
    <button className="sidebar-item" onClick={onNewWorkspace} title="New workspace">
      <span className="sidebar-icon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <span className="sidebar-label">New workspace</span>
    </button>
  )

  if (!expanded) return newWorkspaceRow

  return (
    <div className="worktrees-section">
      <div className="wt-section-header">
        <span>Workspaces</span>
        <span className="wt-header-actions">
          <button className="wt-add-btn" onClick={onNewWorkspace} title="New workspace">+</button>
        </span>
      </div>

      {workspaces.length === 0 && <div className="wt-empty">No other workspaces open</div>}

      <div className="wt-list">
        {workspaces.map(ws => {
          const open = !collapsed.has(ws.id)
          return (
            <div key={ws.id}>
              <div className="wt-item" onClick={() => onSelectWorkspace(ws.id)} title={`Focus ${ws.name}`}>
                <div className="wt-item-main">
                  <button
                    className="hub-ws-caret"
                    onClick={(e) => { e.stopPropagation(); toggle(ws.id) }}
                    title={open ? 'Collapse' : 'Expand'}
                    aria-expanded={open}
                  >{open ? '▾' : '▸'}</button>
                  <span className="wt-dot" style={{ background: ws.accentColor ?? 'var(--raven-blue)' }} />
                  <span className="wt-branch">{ws.name}</span>
                  <span className="wt-meta">{ws.terminals.length}</span>
                  <button
                    className="wt-add-btn"
                    onClick={(e) => { e.stopPropagation(); onAddTerminal(ws.id) }}
                    title={`New terminal in ${ws.name}`}
                  >+</button>
                </div>
              </div>
              {open && ws.terminals.map(t => (
                <div
                  key={t.id}
                  className="wt-item hub-term-item"
                  onClick={() => onJumpToPane(ws.id, t.id)}
                  title={`Focus ${t.label}`}
                >
                  <div className="wt-item-main">
                    <span className="wt-dot" style={{ background: t.color }} />
                    <span className="wt-branch">{t.label}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
