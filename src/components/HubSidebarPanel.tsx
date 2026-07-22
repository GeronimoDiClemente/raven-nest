import { useState } from 'react'
import type { AIType } from '../types'
import { ClaudeLogo, GeminiLogo, CodexLogo, CopilotLogo, OpenCodeLogo } from './AILogos'

export interface HubTerminal {
  id: string
  label: string
  color: string
  aiType: AIType
  inHub: boolean
  busy: boolean
}

export interface HubWorkspace {
  id: string
  name: string
  accentColor?: string
  terminals: HubTerminal[]
}

interface Props {
  workspaces: HubWorkspace[]
  expanded: boolean
  onSelectWorkspace: (tabId: string) => void
  onJumpToPane: (tabId: string, paneId: string) => void   // click a row → focus/add in Hub
  onToggleTerminal: (paneId: string) => void              // pin toggle
  onToggleWorkspace: (tabId: string) => void
  onNewWorkspace: () => void
  onAddTerminal: (tabId: string) => void
}

// Agent logo (Claude/Gemini/…) with a colored-dot fallback for plain shells, plus
// a live-status ring when the terminal is emitting output. Replaces the bullet.
function TermAvatar({ aiType, color, busy }: { aiType: AIType; color: string; busy: boolean }) {
  const logo =
    aiType === 'claude' ? <ClaudeLogo size={13} />
    : aiType === 'gemini' ? <GeminiLogo size={13} />
    : aiType === 'codex' ? <CodexLogo size={13} color={color} />
    : aiType === 'copilot' ? <CopilotLogo size={13} />
    : aiType === 'opencode' ? <OpenCodeLogo size={13} color={color} />
    : null
  return (
    <span className={`hub-av${busy ? ' busy' : ''}`} style={{ '--av-color': color } as React.CSSProperties}>
      {logo ?? <span className="hub-av-dot" style={{ background: color }} />}
    </span>
  )
}

function StarIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
    </svg>
  )
}

/**
 * Hub-tab sidebar: the picker that CURATES which terminals live in the Hub. The
 * Hub itself renders like a normal workspace; here the user pins the terminals
 * they use most (from any workspace) into it. Design (per competitor research):
 * NO checkboxes — a pin/star that appears on hover, a separate "In the Hub"
 * section for the curated set, agent logos + live-status instead of bullets.
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

  // Collapsed sidebar (44px): only the New-workspace icon, like the non-Hub rail.
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

  const curated = workspaces.flatMap(ws =>
    ws.terminals.filter(t => t.inHub).map(t => ({ term: t, wsId: ws.id, wsName: ws.name })))

  return (
    <div className="hub-picker">
      {/* Curated set — what's actually in the Hub right now */}
      <div className="hub-sec">
        <div className="hub-sec-head">
          <span className="hub-sec-title">In the Hub</span>
          <span className="hub-sec-n">{curated.length}</span>
        </div>
        {curated.length === 0 ? (
          <div className="hub-sec-empty">Pin terminals below to gather them here</div>
        ) : (
          curated.map(({ term: t, wsId, wsName }) => (
            <div
              key={t.id}
              className="hub-row is-pinned"
              onClick={() => onJumpToPane(wsId, t.id)}
              title={`Focus ${t.label}`}
            >
              <TermAvatar aiType={t.aiType} color={t.color} busy={t.busy} />
              <span className="hub-row-label">{t.label}</span>
              <span className="hub-row-ws">{wsName}</span>
              <button
                className="hub-pin on"
                title={`Remove ${t.label} from Hub`}
                onClick={(e) => { e.stopPropagation(); onToggleTerminal(t.id) }}
              ><StarIcon filled /></button>
            </div>
          ))
        )}
      </div>

      {/* Workspaces — browse everything, pin what you use most */}
      <div className="hub-sec">
        <div className="hub-sec-head">
          <span className="hub-sec-title">Workspaces</span>
          <button className="hub-add" onClick={onNewWorkspace} title="New workspace">+</button>
        </div>
        {workspaces.length === 0 && <div className="hub-sec-empty">No other workspaces open</div>}
        {workspaces.map(ws => {
          const open = !collapsed.has(ws.id)
          const allIn = ws.terminals.length > 0 && ws.terminals.every(t => t.inHub)
          return (
            <div key={ws.id} className="hub-ws">
              <div className="hub-ws-head" onClick={() => onSelectWorkspace(ws.id)} title={`Focus ${ws.name}`}>
                <button
                  className="hub-caret"
                  onClick={(e) => { e.stopPropagation(); toggle(ws.id) }}
                  aria-expanded={open}
                  title={open ? 'Collapse' : 'Expand'}
                >{open ? '▾' : '▸'}</button>
                <span className="wt-dot" style={{ background: ws.accentColor ?? 'var(--raven-blue)' }} />
                <span className="hub-ws-name">{ws.name}</span>
                <span className="hub-ws-n">{ws.terminals.length}</span>
                <button
                  className={`hub-pin${allIn ? ' on' : ''}`}
                  title={allIn ? `Remove ${ws.name} from Hub` : `Add all of ${ws.name}`}
                  onClick={(e) => { e.stopPropagation(); onToggleWorkspace(ws.id) }}
                ><StarIcon filled={allIn} /></button>
                <button
                  className="hub-add hub-ws-add"
                  title={`New terminal in ${ws.name}`}
                  onClick={(e) => { e.stopPropagation(); onAddTerminal(ws.id) }}
                >+</button>
              </div>
              {open && ws.terminals.map(t => (
                <div
                  key={t.id}
                  className={`hub-row${t.inHub ? ' is-pinned' : ''}`}
                  onClick={() => onJumpToPane(ws.id, t.id)}
                  title={`Focus ${t.label}`}
                >
                  <TermAvatar aiType={t.aiType} color={t.color} busy={t.busy} />
                  <span className="hub-row-label">{t.label}</span>
                  <button
                    className={`hub-pin${t.inHub ? ' on' : ''}`}
                    title={t.inHub ? `Remove ${t.label} from Hub` : `Add ${t.label} to Hub`}
                    onClick={(e) => { e.stopPropagation(); onToggleTerminal(t.id) }}
                  ><StarIcon filled={t.inHub} /></button>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
