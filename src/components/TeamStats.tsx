import { useState, useMemo } from 'react'
import { useTeamStats } from '../hooks/useTeamStats'
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
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="2.5" fill="#3b82f6" />
    </svg>
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

  if (!githubToken) {
    return (
      <div className="ts-container">
        <div className="ts-empty">Connect your GitHub account to see team stats</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="ts-container">
        <div className="ts-empty">Loading stats…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="ts-container">
        <div className="ts-empty">{error}</div>
      </div>
    )
  }

  const { developers, totalCommits, totalPrsMerged, topDeveloper } = stats

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
            <span className="ts-card-sub">across all repos</span>
          </div>
          <div className="ts-card ts-card--purple">
            <span className="ts-card-label">PRs merged</span>
            <span className="ts-card-value">{totalPrsMerged}</span>
            <span className="ts-card-sub">{windowDays === 7 ? 'this week' : 'this month'}</span>
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

    </div>
  )
}
