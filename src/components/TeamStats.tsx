import { useTeamStats } from '../hooks/useTeamStats'
import type { PresenceState } from '../hooks/useTeamPresence'

interface TeamStatsProps {
  repos: Array<{ repo_full_name: string }>
  githubToken: string | null
  presence: Record<string, PresenceState>
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

export default function TeamStats({ repos, githubToken, presence }: TeamStatsProps) {
  const { stats, loading, error } = useTeamStats(repos, githubToken)
  const onlineCount = Object.keys(presence).length
  const onlineLogins = new Set(
    Object.values(presence).map(p => p.displayName.split('@')[0].toLowerCase())
  )

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
        <div className="ts-section-title">This week</div>
        <div className="ts-overview-row">
          <div className="ts-card">
            <span className="ts-card-label">Online now</span>
            <span className="ts-card-value">{onlineCount}</span>
            <span className="ts-card-sub">developers active</span>
          </div>
          <div className="ts-card">
            <span className="ts-card-label">Commits</span>
            <span className="ts-card-value">{totalCommits}</span>
            <span className="ts-card-sub">across all repos</span>
          </div>
          <div className="ts-card">
            <span className="ts-card-label">PRs merged</span>
            <span className="ts-card-value">{totalPrsMerged}</span>
            <span className="ts-card-sub">this week</span>
          </div>
          <div className="ts-card">
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
          <div className="ts-empty">No activity in the last 7 days</div>
        ) : (
          <div className="ts-table-wrap">
            <table className="ts-table">
              <thead>
                <tr>
                  <th>Developer</th>
                  <th style={{ textAlign: 'right' }}>Commits</th>
                  <th style={{ textAlign: 'right' }}>PRs</th>
                  <th style={{ textAlign: 'right' }}>Issues</th>
                  <th style={{ textAlign: 'right' }}>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {developers.map(dev => {
                  const isOnline = onlineLogins.has(dev.login.toLowerCase())
                  return (
                    <tr key={dev.login}>
                      <td>
                        <div className="ts-dev-cell">
                          <span className={`ts-status-dot ${isOnline ? 'online' : 'offline'}`} />
                          <img
                            className="ts-avatar"
                            src={dev.avatarUrl}
                            alt={dev.login}
                          />
                          <span>{dev.login}</span>
                        </div>
                      </td>
                      <td className="ts-num">{dev.commits || <span className="ts-muted">—</span>}</td>
                      <td className="ts-num">{dev.prsOpened || <span className="ts-muted">—</span>}</td>
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
