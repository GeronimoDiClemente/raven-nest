import { useEffect, useState } from 'react'
import { paneAccentColor } from '../lib/pane-accent-color'
import { AI_CONFIG } from '../types'
import { useHubTerminal } from '../hooks/useHubTerminal'
import { subscribeToPtyExit } from '../pty-events'
import type { HubEntry } from './HubGrid'

interface Props {
  entry: HubEntry
  focused: boolean
  onFocus: (paneId: string) => void
  onJump: (tabId: string, paneId: string) => void
  onTogglePin: (tabId: string, paneId: string) => void
  // Hub-tab only: remove this terminal from the composed Hub grid. Omitted in
  // the overlay (which shows every terminal and has no show/hide model).
  onHide?: (paneId: string) => void
  // Lets the grouped grid register the tile's root node for scroll-to-tile.
  innerRef?: (el: HTMLDivElement | null) => void
  // The grouped Hub-tab already labels each section with its workspace, so the
  // per-tile workspace chip is redundant there; the flat overlay keeps it.
  showWorkspace?: boolean
}

export default function HubTile({
  entry, focused, onFocus, onJump, onTogglePin, onHide, innerRef, showWorkspace = true,
}: Props) {
  const { pane, tabId, tabName, isActiveTab, busy } = entry
  // Active-tab panes stay mounted at real size behind the overlay — never
  // resize their PTY from a tile (see spec: "PTY size").
  const { containerRef, focusTile } = useHubTerminal(pane.id, !isActiveTab)
  const [ended, setEnded] = useState(false)

  useEffect(() => {
    let alive = true
    window.pty.exists(pane.id).then(exists => { if (alive) setEnded(!exists) })
    return () => { alive = false }
  }, [pane.id])

  // Live exit: flip to the ended badge if the PTY dies while this tile is open.
  useEffect(() => {
    return subscribeToPtyExit((id) => { if (id === pane.id) setEnded(true) })
  }, [pane.id])

  // Keyboard selection (Tab cycling) only moves the selection ring — it does
  // NOT pull DOM focus into the xterm. That keeps Tab/Enter as Hub gestures
  // (cycle / jump); typing into a tile is opt-in via click (see onMouseDown).
  const aiColor = paneAccentColor(pane)
  // What identifies the tile: the user's rename, else their note, else the agent
  // type (same for every tile, so it's the weakest identifier).
  const hubLabel = pane.customLabel ?? pane.note ?? AI_CONFIG[pane.aiType]?.label ?? 'Terminal'

  return (
    <div
      ref={innerRef}
      className={`hub-tile${focused ? ' focused' : ''}`}
      style={{ '--pane-color': aiColor } as React.CSSProperties}
      onMouseDown={() => { onFocus(pane.id); focusTile() }}
      onDoubleClick={() => onJump(tabId, pane.id)}
    >
      <div className="hub-tile-header">
        <span className="pane-color-btn" style={{ background: aiColor, cursor: 'default' }} />
        {/* Identify the terminal by what the user actually named it (rename label,
            then note) — the agent type is the same for every tile, so it's the
            last-resort fallback, not the primary identifier. */}
        <span className="hub-tile-label" style={{ color: aiColor }} title={hubLabel}>{hubLabel}</span>
        {pane.accountName && !AI_CONFIG[pane.aiType]?.noAccount && (
          <span className="pane-account-name">{pane.accountName}</span>
        )}
        {showWorkspace && <span className="hub-tile-ws" title={`Workspace: ${tabName}`}>{tabName}</span>}
        {busy && !ended && <span className="hub-tile-busy" />}
        {ended && <span className="pane-ended-badge">ended</span>}
        <span className="hub-tile-spacer" />
        <button
          className={`hub-tile-pin${pane.pinned ? ' pinned' : ''}`}
          title={pane.pinned ? 'Unpin' : 'Pin to Hub'}
          onClick={(e) => { e.stopPropagation(); onTogglePin(tabId, pane.id) }}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {pane.pinned ? (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M9 4v6l-2 3v2h10v-2l-2-3V4z" /><rect x="11" y="17" width="2" height="4" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M9 4v6l-2 3v2h10v-2l-2-3V4z" /><path d="M12 17v4" />
            </svg>
          )}
        </button>
        <button
          className="hub-tile-open"
          title="Open in workspace"
          onClick={(e) => { e.stopPropagation(); onJump(tabId, pane.id) }}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M7 17L17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {onHide && (
          <button
            className="hub-tile-hide"
            title="Remove from Hub"
            onClick={(e) => { e.stopPropagation(); onHide(pane.id) }}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <div ref={containerRef} className="hub-tile-terminal" />
    </div>
  )
}
