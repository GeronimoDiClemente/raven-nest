import { useState } from 'react'

export interface HubWorkspace {
  id: string
  name: string
  accentColor?: string
  terminals: { id: string; label: string; color: string; hidden?: boolean }[]
}

interface Props {
  workspaces: HubWorkspace[]
  expanded: boolean
  onSelectWorkspace: (tabId: string) => void
  onJumpToPane: (tabId: string, paneId: string) => void
  onToggleTerminal: (paneId: string) => void
  onToggleWorkspace: (tabId: string) => void
  onNewWorkspace: () => void
  onAddTerminal: (tabId: string) => void
}

/**
 * Hub-tab sidebar: the picker that COMPOSES the Hub grid. Each terminal has a
 * checkbox that shows/hides it in the Hub (so you can watch e.g. 1 terminal
 * from one workspace + 3 from another), and clicking its label scrolls that
 * live tile into view *within the Hub* — the Hub is a filterable view, not a
 * launcher, so nothing here navigates away. Styled on the existing
 * WorktreesSection (.wt-*) + sidebar-item tokens to match the rest of the app.
 */
export default function HubSidebarPanel({
  workspaces, expanded, onSelectWorkspace, onJumpToPane,
  onToggleTerminal, onToggleWorkspace, onNewWorkspace, onAddTerminal,
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
          const anyShown = ws.terminals.some(t => !t.hidden)
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
                  <input
                    type="checkbox"
                    className="hub-check"
                    aria-label={`Show all ${ws.name}`}
                    checked={anyShown}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggleWorkspace(ws.id)}
                  />
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
                  className={`wt-item hub-term-item${t.hidden ? ' hub-term-hidden' : ''}`}
                  onClick={() => onJumpToPane(ws.id, t.id)}
                  title={`Focus ${t.label}`}
                >
                  <div className="wt-item-main">
                    <input
                      type="checkbox"
                      className="hub-check"
                      aria-label={`Show ${t.label}`}
                      checked={!t.hidden}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => onToggleTerminal(t.id)}
                    />
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
