import { attentionFor, trendVsPrev } from '../lib/employee-analytics'
import type { OpenPr } from '../hooks/useTeamStats'

export interface MemberRow {
  login: string | null       // null when the member hasn't linked GitHub
  name: string
  avatarUrl: string
  online: boolean
  commits: number
  prsMerged: number
  prevCommits: number
}

function initials(name: string) { return name.split(' ').map(w => w[0]).slice(0, 2).join('') }

function Trend({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="tm-trend up">▲ new</span>
  if (delta === 0) return <span className="tm-trend flat">— 0%</span>
  return <span className={`tm-trend ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}%</span>
}

export default function TeamMemberList({
  members, openPrsByLogin, viewerLogin, onSelect,
}: {
  members: MemberRow[]
  openPrsByLogin: Record<string, OpenPr[]>
  viewerLogin: string
  onSelect: (login: string) => void
}) {
  // Coaching order: members that need attention first, then alphabetical. Never by output.
  const ranked = members.map(m => {
    const openPrs = m.login ? (openPrsByLogin[m.login] ?? []) : []
    const chip = m.login ? attentionFor({ commits: m.commits, prevCommits: m.prevCommits }, openPrs, viewerLogin) : null
    return { m, chip }
  }).sort((a, b) => (a.chip ? 0 : 1) - (b.chip ? 0 : 1) || a.m.name.localeCompare(b.m.name))

  return (
    <div className="tm-list">
      {ranked.map(({ m, chip }) => (
        <div
          key={m.login ?? m.name}
          className={`tm-row${m.login ? '' : ' tm-nolink'}`}
          onClick={() => m.login && onSelect(m.login)}
          role={m.login ? 'button' : undefined}
        >
          <div className="tm-av" style={{ background: m.login ? undefined : '#333' }}>
            {m.avatarUrl ? <img src={m.avatarUrl} alt="" /> : initials(m.name)}
            <span className="tm-dot" style={{ background: m.online ? '#22C55E' : '#555' }} />
          </div>
          <div className="tm-name">{m.name}{m.login && <span className="tm-login">@{m.login}</span>}</div>
          {m.login ? (
            <>
              <div className="tm-act"><b>{m.commits}</b> commits · <b>{m.prsMerged}</b> PRs</div>
              <Trend delta={trendVsPrev(m.commits, m.prevCommits)} />
              <div className="tm-chip-cell">{chip && <span className={`tm-chip ${chip.cls}`}>{chip.text}</span>}</div>
            </>
          ) : (
            <div className="tm-act tm-muted" style={{ gridColumn: '3 / span 3' }}>No GitHub linked</div>
          )}
        </div>
      ))}
    </div>
  )
}
