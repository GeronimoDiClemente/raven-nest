import { useEffect, useRef } from 'react'
import HubTile from './HubTile'
import type { HubGroup, HubFilter } from '../lib/hub-compose'

interface Props {
  groups: HubGroup[]
  counts: { all: number; active: number; pinned: number }
  shownCount: number
  hiddenCount: number
  filter: HubFilter
  // Scroll a specific tile into view (sidebar click). nonce forces a re-scroll
  // even when the same id is clicked twice.
  focusTarget: { id: string; nonce: number } | null
  onFilter: (f: HubFilter) => void
  onJump: (tabId: string, paneId: string) => void        // "open in workspace"
  onTogglePin: (tabId: string, paneId: string) => void
  onHide: (paneId: string) => void                        // remove from Hub
  onShowWorkspace: (tabId: string) => void                // re-show a workspace's hidden terminals
}

// The Hub as a filterable, composable VIEW of terminals across every workspace.
// Tiles are live read/echo mirrors (useHubTerminal); they are grouped by their
// source workspace and the whole thing scrolls, so there is no 12-pane cap. The
// per-terminal show/hide (× on a tile / the sidebar picker) composes exactly the
// set the user wants to watch (e.g. 1 terminal from one workspace + 3 from
// another). The ↗ button on each tile opens that pane in its real workspace.
export default function HubWorkspace({
  groups, counts, shownCount, hiddenCount, filter, focusTarget,
  onFilter, onJump, onTogglePin, onHide, onShowWorkspace,
}: Props) {
  const tileNodes = useRef(new Map<string, HTMLDivElement>())

  // Scroll the requested tile into view when the sidebar picks a terminal.
  useEffect(() => {
    if (!focusTarget) return
    const el = tileNodes.current.get(focusTarget.id)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusTarget])

  return (
    <div className="hub-workspace">
      <div className="hub-toolbar">
        <button className={`hub-chip${filter === 'all' ? ' on' : ''}`} onClick={() => onFilter('all')}>
          All <span className="hub-chip-n">{counts.all}</span>
        </button>
        <button className={`hub-chip${filter === 'active' ? ' on' : ''}`} onClick={() => onFilter('active')}>
          Active <span className="hub-chip-n">{counts.active}</span>
        </button>
        <button className={`hub-chip${filter === 'pinned' ? ' on' : ''}`} onClick={() => onFilter('pinned')}>
          Pinned <span className="hub-chip-n">{counts.pinned}</span>
        </button>
        {hiddenCount > 0 && <span className="hub-hidden-note">{hiddenCount} hidden</span>}
      </div>

      {shownCount === 0 ? (
        <div className="hub-empty">
          {counts.all === 0
            ? 'No terminals yet — open one in any workspace'
            : 'No terminals in this view'}
        </div>
      ) : (
        <div className="hub-scroll">
          {groups.map(g => (
            <section className="hub-group" key={g.tabId}>
              <div className="hub-group-header">
                <span className="wt-dot" style={{ background: g.accentColor ?? 'var(--raven-blue)' }} />
                <span className="hub-group-name">{g.tabName}</span>
                <span className="hub-group-count">{g.entries.length}</span>
                {g.hiddenCount > 0 && (
                  <button
                    className="hub-group-show"
                    title={`Show ${g.hiddenCount} hidden`}
                    onClick={() => onShowWorkspace(g.tabId)}
                  >
                    +{g.hiddenCount}
                  </button>
                )}
              </div>
              {g.entries.length > 0 && (
                <div className="hub-grid">
                  {g.entries.map(e => (
                    <HubTile
                      key={e.pane.id}
                      entry={e}
                      focused={focusTarget?.id === e.pane.id}
                      innerRef={(el) => {
                        if (el) tileNodes.current.set(e.pane.id, el)
                        else tileNodes.current.delete(e.pane.id)
                      }}
                      onFocus={() => {}}
                      onJump={onJump}
                      onTogglePin={onTogglePin}
                      onHide={onHide}
                      showWorkspace={false}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
