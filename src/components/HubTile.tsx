import { useEffect, useState } from 'react'
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
}

export default function HubTile({ entry, focused, onFocus, onJump, onTogglePin }: Props) {
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
  const aiColor = pane.borderColor ?? pane.customColor ?? AI_CONFIG[pane.aiType]?.color ?? '#888888'
  const aiLabel = pane.customLabel ?? AI_CONFIG[pane.aiType].label

  return (
    <div
      className={`hub-tile${focused ? ' focused' : ''}`}
      style={{ '--pane-color': aiColor } as React.CSSProperties}
      onMouseDown={() => { onFocus(pane.id); focusTile() }}
      onDoubleClick={() => onJump(tabId, pane.id)}
    >
      <div className="hub-tile-header">
        <span className="pane-color-btn" style={{ background: aiColor, cursor: 'default' }} />
        <span className="pane-ai-label" style={{ color: aiColor }}>{aiLabel}</span>
        {pane.accountName && !AI_CONFIG[pane.aiType]?.noAccount && (
          <span className="pane-account-name">{pane.accountName}</span>
        )}
        <span className="hub-tile-ws" title={`Workspace: ${tabName}`}>{tabName}</span>
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
      </div>
      <div ref={containerRef} className="hub-tile-terminal" />
    </div>
  )
}
