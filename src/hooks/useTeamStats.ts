import { useState, useEffect, useMemo } from 'react'

export interface DeveloperStats {
  login: string
  avatarUrl: string
  commits: number
  prsOpened: number
  prsMerged: number
  issuesClosed: number
  lastEventAt: string | null
}

export interface TeamStatsData {
  developers: DeveloperStats[]
  totalCommits: number
  totalPrsMerged: number
  topDeveloper: DeveloperStats | null
}

interface GitHubEvent {
  id: string
  type: string
  actor: { login: string; avatar_url: string }
  created_at: string
  payload: {
    action?: string
    commits?: { sha: string; message: string }[]
    pull_request?: { merged?: boolean }
  }
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

function isThisWeek(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() < ONE_WEEK_MS
}

export function aggregateEvents(events: GitHubEvent[]): DeveloperStats[] {
  const map = new Map<string, DeveloperStats>()
  const seen = new Set<string>()

  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    if (!isThisWeek(event.created_at)) continue

    const { login, avatar_url } = event.actor
    if (!map.has(login)) {
      map.set(login, {
        login,
        avatarUrl: avatar_url,
        commits: 0,
        prsOpened: 0,
        prsMerged: 0,
        issuesClosed: 0,
        lastEventAt: null,
      })
    }
    const dev = map.get(login)!

    if (!dev.lastEventAt || event.created_at > dev.lastEventAt) {
      dev.lastEventAt = event.created_at
    }

    if (event.type === 'PushEvent') {
      dev.commits += event.payload.commits?.length ?? 0
    } else if (event.type === 'PullRequestEvent') {
      if (event.payload.action === 'opened') dev.prsOpened++
      if (event.payload.action === 'closed' && event.payload.pull_request?.merged) dev.prsMerged++
    } else if (event.type === 'IssuesEvent' && event.payload.action === 'closed') {
      dev.issuesClosed++
    }
  }

  return Array.from(map.values()).sort((a, b) => b.commits - a.commits)
}

export function useTeamStats(
  repos: Array<{ repo_full_name: string }>,
  githubToken: string | null
): { stats: TeamStatsData; loading: boolean; error: string | null } {
  const [events, setEvents] = useState<GitHubEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const repoNames = useMemo(
    () => repos.map(r => r.repo_full_name).join(','),
    [repos]
  )

  useEffect(() => {
    if (!githubToken || !repoNames) return
    const repoList = repoNames.split(',').filter(Boolean)
    let alive = true
    setLoading(true)
    setError(null)

    const load = async () => {
      try {
        const fetchRepoEvents = async (name: string): Promise<GitHubEvent[]> => {
          const all: GitHubEvent[] = []
          for (let page = 1; page <= 3; page++) {
            const res = await fetch(
              `https://api.github.com/repos/${name}/events?per_page=100&page=${page}`,
              {
                headers: {
                  Authorization: `Bearer ${githubToken}`,
                  Accept: 'application/vnd.github.v3+json',
                },
              }
            )
            if (!res.ok) break
            const events = await res.json() as GitHubEvent[]
            if (events.length === 0) break
            all.push(...events)
            // Stop early if the oldest event on this page is already outside the 7-day window
            const oldest = events[events.length - 1]
            if (Date.now() - new Date(oldest.created_at).getTime() > ONE_WEEK_MS) break
          }
          return all
        }

        const results = await Promise.allSettled(
          repoList.map(name => fetchRepoEvents(name))
        )
        const all: GitHubEvent[] = []
        for (const r of results) {
          if (r.status === 'fulfilled') all.push(...r.value)
        }
        if (alive) setEvents(all)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load stats')
      } finally {
        if (alive) setLoading(false)
      }
    }

    void load()
    return () => { alive = false }
  }, [repoNames, githubToken])

  const developers = useMemo(() => aggregateEvents(events), [events])
  const totalCommits = developers.reduce((s, d) => s + d.commits, 0)
  const totalPrsMerged = developers.reduce((s, d) => s + d.prsMerged, 0)
  const topDeveloper = developers[0] ?? null

  return {
    stats: { developers, totalCommits, totalPrsMerged, topDeveloper },
    loading,
    error,
  }
}
