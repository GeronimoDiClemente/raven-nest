import { useState, useEffect, useMemo } from 'react'
import { useGitHub } from '../hooks/useGitHub'
import { isE2EPreview } from '../lib/e2ePreview'
import { FX_FEED } from '../lib/e2eFixtures'

interface GitHubEvent {
  id: string
  type: string
  actor: { login: string; avatar_url: string }
  repo: { name: string }
  created_at: string
  payload: {
    action?: string
    ref?: string
    ref_type?: string
    commits?: { sha: string; message: string }[]
    pull_request?: { number: number; title: string; merged?: boolean }
    issue?: { number: number; title: string }
  }
}

interface ActivityFeedProps {
  repos: Array<{ repo_full_name: string }>
  githubToken: string | null
  teamMembers: Array<{ email: string; user_id: string | null }>
}

const SUPPORTED_TYPES = new Set(['PushEvent', 'PullRequestEvent', 'IssuesEvent', 'CreateEvent'])

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d`
  return `${Math.floor(days / 30)}mo`
}

function eventBadgeType(type: string): string {
  switch (type) {
    case 'PushEvent': return 'push'
    case 'PullRequestEvent': return 'pr'
    case 'IssuesEvent': return 'issue'
    case 'CreateEvent': return 'create'
    default: return 'push'
  }
}

function eventBadgeLabel(type: string): string {
  switch (type) {
    case 'PushEvent': return 'push'
    case 'PullRequestEvent': return 'PR'
    case 'IssuesEvent': return 'issue'
    case 'CreateEvent': return 'create'
    default: return type
  }
}

function eventAction(event: GitHubEvent): string {
  const p = event.payload
  switch (event.type) {
    case 'PushEvent': {
      const count = p.commits?.length ?? 0
      return `pushed ${count} commit${count !== 1 ? 's' : ''}`
    }
    case 'PullRequestEvent': {
      const prAction = p.action === 'closed' && p.pull_request?.merged ? 'merged' : (p.action ?? 'updated')
      return `${prAction} PR #${p.pull_request?.number ?? ''}`
    }
    case 'IssuesEvent':
      return `${p.action ?? 'updated'} issue #${p.issue?.number ?? ''}`
    case 'CreateEvent':
      return `created ${p.ref_type ?? 'ref'}${p.ref ? ` "${p.ref}"` : ''}`
    default:
      return event.type
  }
}

function eventDetail(event: GitHubEvent): string | null {
  const p = event.payload
  switch (event.type) {
    case 'PushEvent': return p.commits?.[0]?.message?.split('\n')[0] ?? null
    case 'PullRequestEvent': return p.pull_request?.title ?? null
    case 'IssuesEvent': return p.issue?.title ?? null
    default: return null
  }
}


function SkeletonFeed() {
  return (
    <div className="feed-skeleton">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="feed-skeleton-item">
          <div className="feed-skeleton-icon" />
          <div className="feed-skeleton-lines">
            <div className="feed-skeleton-line short" />
            <div className="feed-skeleton-line long" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ActivityFeed({ repos, githubToken, teamMembers: _teamMembers }: ActivityFeedProps) {
  const [events, setEvents] = useState<GitHubEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { connectGitHub } = useGitHub()

  // Stabilize the useEffect dependency — avoids re-fetch when the array changes reference but not content
  const repoNames = useMemo(() => repos.map(r => r.repo_full_name).join(','), [repos])

  useEffect(() => {
    if (!githubToken || !repoNames) return
    const repoList = repoNames.split(',').filter(Boolean)

    let alive = true
    setLoading(true)
    setError(null)

    const load = async () => {
      try {
        const results = await Promise.allSettled(
          repoList.map(name =>
            fetch(`https://api.github.com/repos/${name}/events?per_page=10`, {
              headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: 'application/vnd.github.v3+json',
              },
            }).then(res => {
              if (!res.ok) return [] as GitHubEvent[]
              return res.json() as Promise<GitHubEvent[]>
            })
          )
        )

        const seen = new Set<string>()
        const all: GitHubEvent[] = []
        for (const r of results) {
          if (r.status === 'fulfilled') {
            for (const ev of r.value) {
              if (!SUPPORTED_TYPES.has(ev.type)) continue
              // Skip PushEvents with no commits (force-push markers, branch deletions, etc.)
              if (ev.type === 'PushEvent' && (ev.payload.commits?.length ?? 0) === 0) continue
              if (seen.has(ev.id)) continue
              seen.add(ev.id)
              all.push(ev)
            }
          }
        }

        all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

        if (alive) setEvents(all)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load activity')
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()
    return () => { alive = false }
  }, [repoNames, githubToken])

  if (isE2EPreview()) {
    return (
      <div className="feed-container">
        {FX_FEED.map(ev => (
          <div key={ev.id} className="feed-event">
            <div className="feed-avatar" aria-hidden />
            <div className="feed-event-content">
              <div className="feed-event-top">
                <div className="feed-event-main"><span className="feed-actor">{ev.actor}</span> {ev.action}</div>
                <span className="feed-time">{ev.ago}</span>
              </div>
              {ev.detail && <div className="feed-event-detail">"{ev.detail}"</div>}
              <div className="feed-event-meta">
                <span className={`feed-type-badge ${ev.badge}`}>{ev.badge === 'pr' ? 'PR' : ev.badge}</span>
                <span className="feed-repo">{ev.repo}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  // No token
  if (!githubToken) {
    return (
      <div className="feed-empty-state">
        <p className="feed-empty-text">Connect your GitHub account to see team activity</p>
        <button
          className="snippet-save-btn"
          style={{ marginTop: 12 }}
          onClick={() => { void connectGitHub() }}
        >
          Connect GitHub
        </button>
      </div>
    )
  }

  // No repos
  if (!repoNames) {
    return (
      <div className="feed-empty-state">
        <p className="feed-empty-text">Add repos to your team to see activity</p>
      </div>
    )
  }

  if (loading) return <SkeletonFeed />

  if (error) return <p className="snippet-empty" style={{ color: '#EF4444' }}>{error}</p>

  if (events.length === 0) {
    return <p className="snippet-empty">No recent activity.</p>
  }

  return (
    <div className="feed-container">
      {events.map(ev => {
        const detail = eventDetail(ev)
        return (
          <div key={ev.id} className="feed-event">
            <img src={ev.actor.avatar_url} alt={ev.actor.login} className="feed-avatar" />
            <div className="feed-event-content">
              <div className="feed-event-top">
                <div className="feed-event-main">
                  <span className="feed-actor">{ev.actor.login}</span>
                  {' '}{eventAction(ev)}
                </div>
                <span className="feed-time">{timeAgo(ev.created_at)}</span>
              </div>
              {detail && <div className="feed-event-detail">"{detail}"</div>}
              <div className="feed-event-meta">
                <span className={`feed-type-badge ${eventBadgeType(ev.type)}`}>
                  {eventBadgeLabel(ev.type)}
                </span>
                <span className="feed-repo">{ev.repo.name}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
