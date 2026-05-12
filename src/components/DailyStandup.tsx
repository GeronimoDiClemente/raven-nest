import { useState, useEffect } from 'react'
import { safeWriteText } from '../lib/clipboard'

interface GitHubEvent {
  id: string
  type: string
  actor: { login: string; avatar_url: string }
  repo: { name: string }
  created_at: string
  payload: {
    action?: string
    ref?: string
    commits?: { sha: string; message: string }[]
    pull_request?: { number: number; title: string; merged?: boolean }
    issue?: { number: number; title: string }
  }
}

interface DailyStandupProps {
  repos: Array<{ repo_full_name: string }>
  githubToken: string | null
  // H6: To correctly attribute GitHub events to team members, callers SHOULD
  // pass `github_login` per member. The previous code matched `member.user_id`
  // (a Supabase UUID) against `actor.login` (a GitHub username) — these never
  // equal, so every member showed "No activity in the last 24h".
  //
  // TODO(H6): TeamsWorkspace currently cannot resolve other members'
  // `github_login` from the client because `profiles` RLS only allows
  // `auth.uid() = id`. Recommended fix:
  //   (a) Denormalize `github_login` onto `team_members` (write on team join
  //       / GitHub connect), OR
  //   (b) Add a SECURITY DEFINER view/function exposing only
  //       (user_id, github_login) for users sharing at least one team with
  //       the caller, OR
  //   (c) Loosen the profiles SELECT policy to expose only the github_login
  //       column to teammates (requires column-level RLS or a separate
  //       public view).
  // Until then, teammates without `github_login` will fall through to
  // "No activity" — which is incorrect but at least honest about the gap.
  teamMembers: Array<{ email: string; user_id: string | null; github_login?: string | null }>
}

interface ActorSummary {
  login: string
  activities: string[]
  openPRs: number
}

const CUTOFF_MS = 86_400_000

function formatDateEn(date: Date): string {
  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function summarizeEvents(events: GitHubEvent[]): Map<string, ActorSummary> {
  const byActor = new Map<string, ActorSummary>()

  const get = (login: string): ActorSummary => {
    if (!byActor.has(login)) byActor.set(login, { login, activities: [], openPRs: 0 })
    return byActor.get(login)!
  }

  // Aggregate pushes per actor+branch+repo
  const pushes = new Map<string, { count: number; branch: string; repo: string }>()

  for (const ev of events) {
    const actor = ev.actor.login
    const repoShort = ev.repo.name.split('/')[1] ?? ev.repo.name
    const p = ev.payload

    if (ev.type === 'PushEvent') {
      const branch = (p.ref ?? '').replace('refs/heads/', '')
      const key = `${actor}|${branch}|${repoShort}`
      const existing = pushes.get(key)
      const count = p.commits?.length ?? 0
      if (existing) {
        existing.count += count
      } else {
        pushes.set(key, { count, branch, repo: repoShort })
      }
    } else if (ev.type === 'PullRequestEvent') {
      const pr = p.pull_request
      if (!pr) continue
      const summary = get(actor)
      if (p.action === 'opened') {
        summary.activities.push(`opened PR #${pr.number} "${pr.title}" (${repoShort})`)
        summary.openPRs++
      } else if (p.action === 'closed' && pr.merged) {
        summary.activities.push(`merged PR #${pr.number} "${pr.title}" (${repoShort})`)
      } else if (p.action === 'closed') {
        summary.activities.push(`closed PR #${pr.number} "${pr.title}" (${repoShort})`)
      }
    } else if (ev.type === 'IssuesEvent') {
      const issue = p.issue
      if (!issue) continue
      const summary = get(actor)
      if (p.action === 'opened') {
        summary.activities.push(`opened issue #${issue.number} "${issue.title}" (${repoShort})`)
      } else if (p.action === 'closed') {
        summary.activities.push(`closed issue #${issue.number} "${issue.title}" (${repoShort})`)
      }
    }
  }

  // Add push summaries
  for (const [key, { count, branch, repo }] of pushes) {
    const login = key.split('|')[0]
    const summary = get(login)
    summary.activities.push(
      `pushed ${count} commit${count !== 1 ? 's' : ''} to ${branch} (${repo})`
    )
  }

  return byActor
}

function buildStandupText(
  actorMap: Map<string, ActorSummary>,
  teamMembers: DailyStandupProps['teamMembers'],
  pendingPRs: number,
  dateLabel: string
): string {
  const lines: string[] = []
  lines.push(`📋 Standup — ${dateLabel}`)
  lines.push('─'.repeat(35))
  lines.push('')

  for (const member of teamMembers) {
    lines.push(member.email)
    // H6: Match by github_login (the actual GitHub username) when available.
    // Fall back to user_id only for the personal-panel case where the caller
    // intentionally passes githubLogin as user_id (see MyReposPanel).
    const memberLogin = member.github_login ?? member.user_id
    const matched = [...actorMap.values()].find(a =>
      memberLogin ? a.login === memberLogin : false
    )
    // Fall back to showing all actors not matched if no user_id mapping
    if (matched && matched.activities.length > 0) {
      for (const act of matched.activities) {
        lines.push(`  • ${act}`)
      }
    } else {
      lines.push('  • No activity in the last 24h')
    }
    lines.push('')
  }

  // Actors found in GitHub but not matched to a team member
  // H6: same matching rule as above — prefer github_login.
  const unmatchedLogins = [...actorMap.keys()].filter(
    login => !teamMembers.some(m => (m.github_login ?? m.user_id) === login)
  )
  for (const login of unmatchedLogins) {
    const summary = actorMap.get(login)!
    if (summary.activities.length === 0) continue
    lines.push(login)
    for (const act of summary.activities) {
      lines.push(`  • ${act}`)
    }
    lines.push('')
  }

  lines.push('─'.repeat(35))
  if (pendingPRs > 0) {
    lines.push(`⚠ ${pendingPRs} PR${pendingPRs !== 1 ? 's' : ''} pending review`)
  }

  return lines.join('\n')
}

function SkeletonStandup() {
  return (
    <div className="standup-container">
      <div className="feed-skeleton">
        {[1, 2, 3].map(i => (
          <div key={i} className="feed-skeleton-item" style={{ marginBottom: 16 }}>
            <div className="feed-skeleton-lines" style={{ width: '100%' }}>
              <div className="feed-skeleton-line short" style={{ marginBottom: 8 }} />
              <div className="feed-skeleton-line long" />
              <div className="feed-skeleton-line long" style={{ width: '55%' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DailyStandup({ repos, githubToken, teamMembers }: DailyStandupProps) {
  const [actorMap, setActorMap] = useState<Map<string, ActorSummary>>(new Map())
  const [pendingPRs, setPendingPRs] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const dateLabel = formatDateEn(new Date())

  useEffect(() => {
    if (!githubToken || repos.length === 0) return

    let alive = true
    setLoading(true)
    setError(null)

    const load = async () => {
      try {
        const results = await Promise.allSettled(
          repos.map(r =>
            fetch(`https://api.github.com/repos/${r.repo_full_name}/events?per_page=30`, {
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

        const cutoff = Date.now() - CUTOFF_MS
        const all: GitHubEvent[] = []
        for (const r of results) {
          if (r.status === 'fulfilled') {
            for (const ev of r.value) {
              if (new Date(ev.created_at).getTime() > cutoff) {
                all.push(ev)
              }
            }
          }
        }

        const map = summarizeEvents(all)

        // Count open PRs (PullRequestEvent opened in last 24h that haven't been merged/closed)
        const openPRCount = [...map.values()].reduce((sum, a) => sum + a.openPRs, 0)

        if (alive) {
          setActorMap(map)
          setPendingPRs(openPRCount)
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load standup')
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()
    return () => { alive = false }
  }, [repos, githubToken])

  const standupText = buildStandupText(actorMap, teamMembers, pendingPRs, dateLabel)

  const handleCopy = () => {
    void safeWriteText(standupText).then(ok => {
      if (ok) {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    })
  }

  if (!githubToken) {
    return (
      <div className="feed-empty-state">
        <p className="feed-empty-text">Connect GitHub to see the standup</p>
      </div>
    )
  }

  if (repos.length === 0) {
    return (
      <div className="feed-empty-state">
        <p className="feed-empty-text">Add repos to the team</p>
      </div>
    )
  }

  if (loading) return <SkeletonStandup />

  if (error) return <p className="snippet-empty" style={{ color: '#EF4444' }}>{error}</p>

  return (
    <div className="standup-container">
      <div className="standup-header">
        <span className="standup-title">📋 Standup — {dateLabel}</span>
        <button className="standup-copy-btn" onClick={handleCopy}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      <div className="standup-divider" />

      {teamMembers.map(member => {
        // H6: Prefer github_login; fall back to user_id (personal-panel case).
        const memberLogin = member.github_login ?? member.user_id
        const matched = [...actorMap.values()].find(a =>
          memberLogin ? a.login === memberLogin : false
        )
        const activities = matched?.activities ?? []

        return (
          <div key={member.email} className="standup-member">
            <div className="standup-member-name">{member.email}</div>
            {activities.length > 0 ? (
              <ul className="standup-member-activity">
                {activities.map((act, i) => (
                  <li key={i}>{act}</li>
                ))}
              </ul>
            ) : (
              <p className="standup-empty-member">No activity in the last 24h</p>
            )}
          </div>
        )
      })}

      {/* Unmatched GitHub actors */}
      {[...actorMap.entries()]
        // H6: Prefer github_login when matching.
        .filter(([login]) => !teamMembers.some(m => (m.github_login ?? m.user_id) === login))
        .filter(([, summary]) => summary.activities.length > 0)
        .map(([login, summary]) => (
          <div key={login} className="standup-member">
            <div className="standup-member-name">{login}</div>
            <ul className="standup-member-activity">
              {summary.activities.map((act, i) => (
                <li key={i}>{act}</li>
              ))}
            </ul>
          </div>
        ))
      }

      <div className="standup-divider" />

      {pendingPRs > 0 && (
        <div className="standup-summary">
          ⚠ {pendingPRs} PR{pendingPRs !== 1 ? 's' : ''} pending review
        </div>
      )}
    </div>
  )
}
