import { useState } from 'react'

export interface HubWorkspace {
  id: string
  name: string
  accentColor?: string
  terminals: { id: string; label: string; color: string }[]
}

interface Props {
  workspaces: HubWorkspace[]
  onSelectWorkspace: (tabId: string) => void
  onJumpToPane: (tabId: string, paneId: string) => void
  onNewWorkspace: () => void
  onAddTerminal: (tabId: string) => void
}

/**
 * Hub-tab sidebar: build/navigate a workflow across every open workspace —
 * list workspaces, jump into one, jump to a specific terminal, spin up a new
 * terminal in a chosen workspace, or open a fresh workspace. Pure/presentational
 * so it renders in isolation; all state lives in App.
 */
export default function HubSidebarPanel({
  workspaces, onSelectWorkspace, onJumpToPane, onNewWorkspace, onAddTerminal,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className="hub-side">
      <div className="hub-side-caption">Workspaces</div>

      <button className="sidebar-item hub-side-new" onClick={onNewWorkspace} title="New workspace">
        <span className="sidebar-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <span className="sidebar-label">New workspace</span>
      </button>

      {workspaces.length === 0 && (
        <div className="hub-side-empty">No other workspaces open</div>
      )}

      {workspaces.map(ws => {
        const open = !collapsed.has(ws.id)
        return (
          <div className="hub-side-ws" key={ws.id}>
            <div className="hub-side-ws-row">
              <button
                className="hub-side-caret"
                onClick={() => toggle(ws.id)}
                title={open ? 'Collapse' : 'Expand'}
                aria-expanded={open}
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(90deg)' : 'none' }} aria-hidden="true">
                  <path d="M4 3l4 3-4 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button className="hub-side-ws-name" onClick={() => onSelectWorkspace(ws.id)} title={`Go to ${ws.name}`}>
                <span className="hub-side-dot" style={{ background: ws.accentColor ?? 'var(--raven-blue)' }} />
                <span className="hub-side-ws-label">{ws.name}</span>
                <span className="hub-side-count">{ws.terminals.length}</span>
              </button>
              <button className="hub-side-add" onClick={() => onAddTerminal(ws.id)} title={`New terminal in ${ws.name}`}>+</button>
            </div>
            {open && ws.terminals.length > 0 && (
              <div className="hub-side-terms">
                {ws.terminals.map(t => (
                  <button key={t.id} className="hub-side-term" onClick={() => onJumpToPane(ws.id, t.id)} title={`Go to ${t.label}`}>
                    <span className="hub-side-term-dot" style={{ background: t.color }} />
                    <span className="hub-side-term-label">{t.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
