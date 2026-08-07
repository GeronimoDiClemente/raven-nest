import { useEffect, useState } from 'react'
import type { BoardRow } from '../integrations/board'
import type { ActivityEntry } from '../types'
import { formatActivity, timeAgo } from '../lib/formatActivity'
import CalendarPanel from './CalendarPanel'

interface Props {
  rows: BoardRow[]
  onOpenRow?: (row: BoardRow) => void
  /** branch -> teammate display name, for the "<name> is here" presence chip
   *  (team-presence — see useTeamPresence). Omitted/empty renders no chips. */
  presenceByBranch?: Record<string, string>
  /** H6 block→session (see IntegrationsHub.startCalendarSession). Omitted ->
   *  the "Today" calendar section doesn't mount at all. */
  onStartCalendarSession?: (title: string, context: string) => void
  calendarBusy?: boolean
  calendarError?: string | null
}

const ACTIVITY_CAP = 50

/** Right rail of the Integrations hub: the @Nest bot widget, a Needs-you
 *  queue for rows that need a human call, and the Activity feed — fed by
 *  the event bus's DomainEvents (`window.activity`, same push pattern as
 *  `signals`/`slackMentions`). */
export function IntegrationsRail({ rows, onOpenRow, presenceByBranch, onStartCalendarSession, calendarBusy, calendarError }: Props) {
  const needsYou = rows.filter((r) => r.status === 'needs_you')
  const [entries, setEntries] = useState<ActivityEntry[]>([])

  useEffect(() => {
    // `window.activity?` is defensive: the bridge may not exist yet
    // (preload timing) or be absent in test environments that only mock
    // other bridges — same convention as `useWorktreeSignals`.
    window.activity?.list?.().then(setEntries).catch(() => {})
    return window.activity?.onAppend?.((entry) => {
      setEntries((prev) => [entry, ...prev].slice(0, ACTIVITY_CAP))
    })
  }, [])

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

      {onStartCalendarSession && (
        <div className="ih-today-block">
          <div className="ih-railh">Today</div>
          {calendarError && <div className="tk-error" role="alert" style={{ margin: '4px 0' }}>{calendarError}</div>}
          <CalendarPanel onStartSession={onStartCalendarSession} busy={calendarBusy} />
        </div>
      )}

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
            <div className="ih-need-sub">
              open in {row.branch ?? 'new workspace'} →
              {row.branch && presenceByBranch?.[row.branch] && (
                <span className="ob-here">{`· ${presenceByBranch[row.branch]} is here`}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="ih-act-block">
        <div className="ih-railh">Activity</div>
        {entries.length === 0
          ? <div className="ih-act-empty">Activity will appear here.</div>
          : entries.map((entry, i) => {
              const { icon, text } = formatActivity(entry.ev)
              return (
                <div className="ih-act-item" key={`${entry.ts}-${i}`}>
                  <span className="ih-act-icon">{icon}</span>
                  <span className="ih-act-text">{text}</span>
                  <span className="ih-act-time">{timeAgo(entry.ts)}</span>
                </div>
              )
            })}
      </div>
    </div>
  )
}
