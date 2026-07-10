import { useState, useEffect, useMemo } from 'react'

export interface DeveloperStats {
  login: string
  avatarUrl: string
  commits: number
  prsOpened: number
  prsMerged: number
  issuesClosed: number
  lastEventAt: string | null
  dailyCommits: number[]   // 7 elements, index 0 = 6 days ago, index 6 = today
}

export interface RecentPR {
  id: string
  login: string
  avatarUrl: string
  title: string
  repo: string      // full repo name e.g. "owner/repo"
  mergedAt: string  // ISO string
}

export interface TeamStatsData {
  developers: DeveloperStats[]
  totalCommits: number
  totalPrsMerged: number
  topDeveloper: DeveloperStats | null
  recentPrs: RecentPR[]
  /** Totales del período INMEDIATAMENTE anterior (misma duración), para deltas. */
  prevCommits: number
  prevPrsMerged: number
}

interface GitHubEvent {
  id: string
  type: string
  actor: { login: string; avatar_url: string }
  repo: { name: string }   // full repo name e.g. "owner/repo"
  created_at: string
  payload: {
    action?: string
    commits?: { sha: string; message: string }[]
    pull_request?: { merged?: boolean; title?: string }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

function isWithinWindow(dateStr: string, windowDays: number): boolean {
  return Date.now() - new Date(dateStr).getTime() < windowDays * DAY_MS
}

export function aggregateEvents(events: GitHubEvent[], windowDays = 7): DeveloperStats[] {
  const map = new Map<string, DeveloperStats>()
  const seen = new Set<string>()

  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    if (!isWithinWindow(event.created_at, windowDays)) continue

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
        dailyCommits: Array(windowDays).fill(0),
      })
    }
    const dev = map.get(login)!

    if (!dev.lastEventAt || event.created_at > dev.lastEventAt) {
      dev.lastEventAt = event.created_at
    }

    if (event.type === 'PushEvent') {
      const count = event.payload.commits?.length ?? 0
      dev.commits += count
      const daysAgo = Math.floor((Date.now() - new Date(event.created_at).getTime()) / DAY_MS)
      if (daysAgo < windowDays) dev.dailyCommits[windowDays - 1 - daysAgo] += count
    } else if (event.type === 'PullRequestEvent') {
      if (event.payload.action === 'opened') dev.prsOpened++
      if (event.payload.action === 'closed' && event.payload.pull_request?.merged) dev.prsMerged++
    } else if (event.type === 'IssuesEvent' && event.payload.action === 'closed') {
      dev.issuesClosed++
    }
  }

  return Array.from(map.values()).sort((a, b) => b.commits - a.commits)
}

export function extractRecentPrs(events: GitHubEvent[], windowDays = 7): RecentPR[] {
  const seen = new Set<string>()
  const prs: RecentPR[] = []

  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    if (!isWithinWindow(event.created_at, windowDays)) continue
    if (event.type !== 'PullRequestEvent') continue
    if (event.payload.action !== 'closed') continue
    if (!event.payload.pull_request?.merged) continue

    prs.push({
      id: event.id,
      login: event.actor.login,
      avatarUrl: event.actor.avatar_url,
      title: event.payload.pull_request.title ?? '(no title)',
      repo: event.repo?.name ?? '',
      mergedAt: event.created_at,
    })
  }

  return prs.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))
}

/** Suma commits y PRs mergeados en la ventana [fromDaysAgo, toDaysAgo) (días atrás). */
export function windowTotals(
  events: GitHubEvent[],
  fromDaysAgo: number,
  toDaysAgo: number,
): { commits: number; prsMerged: number } {
  const seen = new Set<string>()
  let commits = 0
  let prsMerged = 0
  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    const ageDays = (Date.now() - new Date(event.created_at).getTime()) / DAY_MS
    if (ageDays < fromDaysAgo || ageDays >= toDaysAgo) continue
    if (event.type === 'PushEvent') {
      commits += event.payload.commits?.length ?? 0
    } else if (
      event.type === 'PullRequestEvent' &&
      event.payload.action === 'closed' &&
      event.payload.pull_request?.merged
    ) {
      prsMerged++
    }
  }
  return { commits, prsMerged }
}

export function useTeamStats(
  repos: Array<{ repo_full_name: string }>,
  githubToken: string | null,
  windowDays = 7,
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
            // Traemos 2× la ventana para poder comparar contra el período anterior (deltas).
            const oldest = events[events.length - 1]
            if (Date.now() - new Date(oldest.created_at).getTime() > windowDays * 2 * DAY_MS) break
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
  }, [repoNames, githubToken, windowDays])

  const developers = useMemo(() => aggregateEvents(events, windowDays), [events, windowDays])
  const totalCommits = developers.reduce((s, d) => s + d.commits, 0)
  const totalPrsMerged = developers.reduce((s, d) => s + d.prsMerged, 0)
  const topDeveloper = developers[0] ?? null
  const recentPrs = useMemo(() => extractRecentPrs(events, windowDays), [events, windowDays])
  const prev = useMemo(() => windowTotals(events, windowDays, windowDays * 2), [events, windowDays])

  return {
    stats: {
      developers, totalCommits, totalPrsMerged, topDeveloper, recentPrs,
      prevCommits: prev.commits, prevPrsMerged: prev.prsMerged,
    },
    loading,
    error,
  }
}
