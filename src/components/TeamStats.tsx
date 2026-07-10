import { useState, useMemo } from 'react'
import { useTeamStats, type DeveloperStats } from '../hooks/useTeamStats'
import type { PresenceState } from '../hooks/useTeamPresence'

interface TeamStatsProps {
  repos: Array<{ repo_full_name: string }>
  githubToken: string | null
  presence: Record<string, PresenceState>
}

export function onlineGithubLogins(presence: Record<string, PresenceState>): Set<string> {
  const set = new Set<string>()
  for (const p of Object.values(presence)) {
    if (p.githubLogin) set.add(p.githubLogin.toLowerCase())
  }
  return set
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

function AreaSparkline({ data, gradId }: { data: number[]; gradId: string }) {
  const W = 64, H = 26
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: H - Math.max(3, (v / max) * H),
  }))
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const last = pts[pts.length - 1]
  return (
    <svg className="ts-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ts-accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--ts-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} stroke="var(--ts-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="2.5" fill="var(--ts-accent)" />
    </svg>
  )
}

// ▲/▼ vs período anterior. Verde/rojo semánticos, nunca color solo (lleva flecha + %).
function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) {
    if (current === 0) return null
    return <span className="ts-delta up" title="Sin actividad en el período anterior">▲ nuevo</span>
  }
  const pct = Math.round(((current - previous) / previous) * 100)
  if (pct === 0) return <span className="ts-delta flat">— 0%</span>
  const up = pct > 0
  return (
    <span className={`ts-delta ${up ? 'up' : 'down'}`} title={`${current} vs ${previous} en el período anterior`}>
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  )
}

function dayLabel(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000)
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
}

// Actividad del equipo por día — una sola serie (azul de marca), con hover por barra.
function TeamBarChart({ daily }: { daily: number[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const n = daily.length
  const max = Math.max(...daily, 1)
  const total = daily.reduce((a, b) => a + b, 0)
  return (
    <div className="ts-chart">
      <div className="ts-chart-bars" onMouseLeave={() => setHover(null)}>
        {daily.map((v, i) => {
          const daysAgo = n - 1 - i
          return (
            <div
              key={i}
              className={`ts-bar-col${hover === i ? ' hover' : ''}`}
              onMouseEnter={() => setHover(i)}
            >
              {hover === i && (
                <div className="ts-bar-tip">
                  <strong>{v}</strong> commit{v === 1 ? '' : 's'}
                  <span>{daysAgo === 0 ? 'today' : dayLabel(daysAgo)}</span>
                </div>
              )}
              <div className="ts-bar" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
            </div>
          )
        })}
      </div>
      <div className="ts-chart-foot">
        <span>{dayLabel(n - 1)}</span>
        <span className="ts-chart-total">{total} commits en el período</span>
        <span>today</span>
      </div>
    </div>
  )
}

const MEDALS = ['🥇', '🥈', '🥉']
function Podium({ devs, online }: { devs: DeveloperStats[]; online: Set<string> }) {
  const top = devs.slice(0, 3)
  if (top.length === 0) return null
  return (
    <div className="ts-podium">
      {top.map((dev, i) => (
        <div key={dev.login} className={`ts-podium-card ts-podium-${i}`}>
          <span className="ts-medal" aria-hidden>{MEDALS[i]}</span>
          <img className="ts-podium-av" src={dev.avatarUrl} alt={dev.login} />
          <span className="ts-podium-name">
            <span className={`ts-status-dot ${online.has(dev.login.toLowerCase()) ? 'online' : 'offline'}`} />
            {dev.login}
          </span>
          <span className="ts-podium-commits">{dev.commits} commits</span>
          <span className="ts-podium-sub">{dev.prsMerged} PRs · {dev.issuesClosed} issues</span>
        </div>
      ))}
    </div>
  )
}

// Matriz devs × días (quién trabajó cuándo). Secuencial de un solo hue (azul).
function TeamHeatmap({ devs }: { devs: DeveloperStats[] }) {
  const rows = devs.slice(0, 8)
  if (rows.length === 0) return null
  const max = Math.max(1, ...rows.flatMap(d => d.dailyCommits))
  const n = rows[0].dailyCommits.length
  return (
    <div className="ts-heatmap">
      {rows.map(dev => (
        <div key={dev.login} className="ts-heat-row">
          <span className="ts-heat-name">{dev.login}</span>
          <div className="ts-heat-cells" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
            {dev.dailyCommits.map((v, i) => {
              const daysAgo = n - 1 - i
              const alpha = v <= 0 ? 0 : 0.15 + 0.85 * (v / max)
              return (
                <div
                  key={i}
                  className="ts-heat-cell"
                  style={v > 0 ? { background: `rgba(0,102,255,${alpha.toFixed(2)})` } : undefined}
                  title={`${dev.login} — ${v} commit${v === 1 ? '' : 's'} ${daysAgo === 0 ? 'today' : `${daysAgo}d ago`}`}
                />
              )
            })}
          </div>
        </div>
      ))}
      {devs.length > rows.length && (
        <div className="ts-heat-more">+{devs.length - rows.length} developers más</div>
      )}
    </div>
  )
}

function StatsSkeleton() {
  return (
    <div className="ts-container" aria-busy="true" aria-label="Loading team stats">
      <div className="ts-overview-row">
        {[0, 1, 2, 3].map(i => <div key={i} className="ts-skeleton ts-skel-card" />)}
      </div>
      <div>
        {[0, 1, 2, 3, 4].map(i => <div key={i} className="ts-skeleton ts-skel-row" />)}
      </div>
    </div>
  )
}

export default function TeamStats({ repos, githubToken, presence }: TeamStatsProps) {
  const [windowDays, setWindowDays] = useState<7 | 30>(7)
  const { stats, loading, error } = useTeamStats(repos, githubToken, windowDays)
  const onlineCount = Object.keys(presence).length
  const onlineLogins = onlineGithubLogins(presence)

  type SortKey = 'commits' | 'prs' | 'issues'
  const [sortKey, setSortKey] = useState<SortKey>('commits')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortedDevs = useMemo(() => {
    return [...stats.developers].sort((a, b) => {
      const va = sortKey === 'commits' ? a.commits
        : sortKey === 'prs' ? a.prsOpened + a.prsMerged
        : a.issuesClosed
      const vb = sortKey === 'commits' ? b.commits
        : sortKey === 'prs' ? b.prsOpened + b.prsMerged
        : b.issuesClosed
      return sortDir === 'desc' ? vb - va : va - vb
    })
  }, [stats.developers, sortKey, sortDir])

  // Commits del equipo por día = suma de los dailyCommits de cada dev.
  const teamDaily = useMemo(() => {
    const n = stats.developers[0]?.dailyCommits.length ?? windowDays
    const out = Array<number>(n).fill(0)
    for (const d of stats.developers) d.dailyCommits.forEach((c, i) => { out[i] += c })
    return out
  }, [stats.developers, windowDays])

  if (!githubToken) {
    return (
      <div className="ts-container">
        <div className="ts-empty">
          <svg className="ts-empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" />
            <path d="M8 12h8M12 8v8" strokeLinecap="round" />
          </svg>
          Connect your GitHub account to see team stats
        </div>
      </div>
    )
  }

  if (loading) {
    return <StatsSkeleton />
  }

  if (error) {
    return (
      <div className="ts-container">
        <div className="ts-empty">{error}</div>
      </div>
    )
  }

  const { developers, totalCommits, totalPrsMerged, topDeveloper, prevCommits, prevPrsMerged } = stats

  return (
    <div className="ts-container">
      {/* Overview cards */}
      <div>
        <div className="ts-cards-header">
          <div className="ts-section-title">{windowDays === 7 ? 'This week' : 'This month'}</div>
          <div className="ts-toggle" role="tablist" aria-label="Time period">
            <button
              role="tab"
              aria-selected={windowDays === 7}
              className={`ts-toggle-btn${windowDays === 7 ? ' active' : ''}`}
              onClick={() => setWindowDays(7)}
            >Week</button>
            <button
              role="tab"
              aria-selected={windowDays === 30}
              className={`ts-toggle-btn${windowDays === 30 ? ' active' : ''}`}
              onClick={() => setWindowDays(30)}
            >Month</button>
          </div>
        </div>
        <div className="ts-overview-row">
          <div className="ts-card ts-card--green">
            <span className="ts-card-label">Online now</span>
            <span className="ts-card-value">{onlineCount}</span>
            <span className="ts-card-sub">developers active</span>
          </div>
          <div className="ts-card ts-card--blue">
            <span className="ts-card-label">Commits</span>
            <span className="ts-card-value">{totalCommits}</span>
            <span className="ts-card-sub">across all repos <DeltaBadge current={totalCommits} previous={prevCommits} /></span>
          </div>
          <div className="ts-card ts-card--purple">
            <span className="ts-card-label">PRs merged</span>
            <span className="ts-card-value">{totalPrsMerged}</span>
            <span className="ts-card-sub">{windowDays === 7 ? 'this week' : 'this month'} <DeltaBadge current={totalPrsMerged} previous={prevPrsMerged} /></span>
          </div>
          <div className="ts-card ts-card--amber">
            <span className="ts-card-label">Top dev</span>
            <span className="ts-card-value" style={{ fontSize: 14, paddingTop: 4 }}>
              {topDeveloper ? `@${topDeveloper.login}` : '—'}
            </span>
            <span className="ts-card-sub">
              {topDeveloper ? `${topDeveloper.commits} commits` : 'no activity'}
            </span>
          </div>
        </div>
      </div>

      {/* Team activity chart */}
      {developers.length > 0 && (
        <div>
          <div className="ts-section-title">Team activity — commits per day</div>
          <TeamBarChart daily={teamDaily} />
        </div>
      )}

      {/* Top performers podium */}
      {developers.length > 0 && (
        <div>
          <div className="ts-section-title">Top performers</div>
          <Podium devs={developers} online={onlineLogins} />
        </div>
      )}

      {/* Developer table */}
      <div>
        <div className="ts-section-title">Developers</div>
        {developers.length === 0 ? (
          <div className="ts-empty">{`No activity in the last ${windowDays} days`}</div>
        ) : (
          <div className="ts-table-wrap">
            <table className="ts-table">
              <thead>
                <tr>
                  <th>Developer</th>
                  <th style={{ textAlign: 'right' }}>
                    <button className="ts-th-btn" onClick={() => handleSort('commits')}>
                      Commits
                      <span className={`ts-sort-icon${sortKey === 'commits' ? ' active' : ''}`}>
                        {sortKey === 'commits' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
                      </span>
                    </button>
                  </th>
                  <th style={{ textAlign: 'right' }}>
                    <button className="ts-th-btn" onClick={() => handleSort('prs')}>
                      PRs
                      <span className={`ts-sort-icon${sortKey === 'prs' ? ' active' : ''}`}>
                        {sortKey === 'prs' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
                      </span>
                    </button>
                  </th>
                  <th style={{ textAlign: 'right' }}>
                    <button className="ts-th-btn" onClick={() => handleSort('issues')}>
                      Issues
                      <span className={`ts-sort-icon${sortKey === 'issues' ? ' active' : ''}`}>
                        {sortKey === 'issues' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
                      </span>
                    </button>
                  </th>
                  <th style={{ textAlign: 'right' }}>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {sortedDevs.map((dev, i) => {
                  const isOnline = onlineLogins.has(dev.login.toLowerCase())
                  const isTop = i === 0
                  return (
                    <tr key={dev.login} className={isTop ? 'ts-top-row' : undefined}>
                      <td>
                        <div className="ts-dev-cell">
                          <span className="ts-rank">{i + 1}</span>
                          <span className={`ts-status-dot ${isOnline ? 'online' : 'offline'}`} />
                          <img
                            className="ts-avatar"
                            src={dev.avatarUrl}
                            alt={dev.login}
                          />
                          <div className="ts-dev-info">
                            <span className="ts-dev-name">{dev.login}</span>
                            <AreaSparkline data={dev.dailyCommits} gradId={`ts-sg-${dev.login}`} />
                          </div>
                        </div>
                      </td>
                      <td className="ts-num">{dev.commits || <span className="ts-muted">—</span>}</td>
                      <td className="ts-num">{dev.prsOpened + dev.prsMerged || <span className="ts-muted">—</span>}</td>
                      <td className="ts-num">{dev.issuesClosed || <span className="ts-muted">—</span>}</td>
                      <td className="ts-num ts-muted">{timeAgo(dev.lastEventAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Activity matrix — who worked when */}
      {developers.length > 0 && (
        <div>
          <div className="ts-section-title">Activity matrix — who worked when</div>
          <TeamHeatmap devs={developers} />
        </div>
      )}

    </div>
  )
}
