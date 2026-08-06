import type { BoardRow } from '../integrations/board'

interface Props {
  rows: BoardRow[]
  onOpenRow?: (row: BoardRow) => void
}

/** Right rail of the Integrations hub: the @Nest bot widget, a Needs-you
 *  queue for rows that need a human call, and an Activity placeholder
 *  (the real feed lands in a later pass — this only reserves the slot). */
export function IntegrationsRail({ rows, onOpenRow }: Props) {
  const needsYou = rows.filter((r) => r.status === 'needs_you')

  return (
    <div className="ih-rail-inner">
      <div className="ih-bot">
        <div className="ih-bot-head">
          <span className="ih-bot-avatar">🪺</span>
          <span className="ih-bot-name">@Nest</span>
          <span className="ih-bot-chip">● Slack</span>
        </div>
        <p className="ih-bot-desc">
          Grabs tickets, opens windows in a linked workspace, and asks you the important calls.
        </p>
        <div className="ih-ask">Ask it something… ⌘K</div>
      </div>

      <div className="ih-need-block">
        <div className="ih-railh">
          Needs you
          <span className="ih-railh-count">{needsYou.length}</span>
        </div>
        {needsYou.map((row) => (
          <div
            key={row.key}
            className="ih-need"
            role="button"
            tabIndex={0}
            onClick={() => onOpenRow?.(row)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenRow?.(row) } }}
          >
            <div className="ih-need-title">{row.key} {row.title}</div>
            <div className="ih-need-sub">open in {row.branch ?? 'new workspace'} →</div>
          </div>
        ))}
      </div>

      <div className="ih-act-block">
        <div className="ih-railh">Activity</div>
        <div className="ih-act-empty">Activity will appear here.</div>
      </div>
    </div>
  )
}
