import { useState, useEffect, useMemo } from 'react'

export interface DeveloperStats {
  login: string
  avatarUrl: string
  commits: number
  prsOpened: number
  prsMerged: number
  reviews: number          // PR reviews THIS dev did for others (PullRequestReviewEvent)
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
  totalReviews: number
  /** Median open→merge hours of the PRs merged within the window. null if none. */
  mergeTimeHours: number | null
  topDeveloper: DeveloperStats | null
  recentPrs: RecentPR[]
  /** Totals for the IMMEDIATELY preceding period (same duration), for deltas. */
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
    // created_at/merged_at come in the pull_request object from the Events API; they
    // serve to measure the open→merge time without extra calls.
    pull_request?: { merged?: boolean; title?: string; created_at?: string; merged_at?: string }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
// Max window we fetch from the network (covers 2× the longest period, 30d, for deltas).
// Filtering to 7/30 days happens client-side, so toggling Week/Month doesn't re-fetch.
const MAX_DAYS = 60
// Limit of repos in parallel, to avoid triggering GitHub's secondary rate limit.
const CONCURRENCY = 5
// Only these event types count as a "contribution" and create a developer row.
// Without this, a WatchEvent/ForkEvent/comment adds people who didn't commit to the roster.
const CONTRIB_TYPES = new Set(['PushEvent', 'PullRequestEvent', 'PullRequestReviewEvent', 'IssuesEvent'])
const isBot = (login: string): boolean => login.endsWith('[bot]')

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
    // Exclude non-contribution events (stars, forks, comments) and bots,
    // so they don't pollute the roster / podium with rows of 0 commits.
    if (!CONTRIB_TYPES.has(event.type)) continue

    const { login, avatar_url } = event.actor
    if (isBot(login)) continue
    if (!map.has(login)) {
      map.set(login, {
        login,
        avatarUrl: avatar_url,
        commits: 0,
        prsOpened: 0,
        prsMerged: 0,
        reviews: 0,
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
    } else if (event.type === 'PullRequestReviewEvent') {
      if (event.payload.action === 'created') dev.reviews++
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

/**
 * Median open→merge hours of the PRs merged within the window.
 * Uses created_at/merged_at from the Events API payload (no extra calls).
 * Median instead of average: an old PR of several days doesn't distort the number.
 * Returns null if no merged PR carries both dates.
 */
export function medianMergeHours(events: GitHubEvent[], windowDays = 7): number | null {
  const seen = new Set<string>()
  const durs: number[] = []
  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    if (!isWithinWindow(event.created_at, windowDays)) continue
    if (event.type !== 'PullRequestEvent' || event.payload.action !== 'closed') continue
    const pr = event.payload.pull_request
    if (!pr?.merged || !pr.created_at || !pr.merged_at) continue
    const h = (new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime()) / 3_600_000
    if (h >= 0) durs.push(h)
  }
  if (durs.length === 0) return null
  durs.sort((a, b) => a - b)
  const mid = Math.floor(durs.length / 2)
  return durs.length % 2 ? durs[mid] : (durs[mid - 1] + durs[mid]) / 2
}

/** Sums commits and merged PRs in the window [fromDaysAgo, toDaysAgo) (days ago). */
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
    if (isBot(event.actor.login)) continue
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
): { stats: TeamStatsData; loading: boolean; error: string | null; warning: string | null } {
  const [events, setEvents] = useState<GitHubEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const repoNames = useMemo(
    () => repos.map(r => r.repo_full_name).join(','),
    [repos]
  )

  // The fetch does NOT depend on windowDays: we fetch MAX_DAYS from the network once and
  // filter client-side to 7/30. Toggling Week/Month doesn't hit GitHub again.
  useEffect(() => {
    if (!githubToken || !repoNames) return
    const repoList = repoNames.split(',').filter(Boolean)
    let alive = true
    setLoading(true)
    setError(null)
    setWarning(null)

    const load = async () => {
      const failed: string[] = []
      const fetchRepoEvents = async (name: string): Promise<GitHubEvent[]> => {
        const all: GitHubEvent[] = []
        for (let page = 1; page <= 3; page++) {
          let res: Response
          try {
            res = await fetch(
              `https://api.github.com/repos/${name}/events?per_page=100&page=${page}`,
              {
                headers: {
                  Authorization: `Bearer ${githubToken}`,
                  Accept: 'application/vnd.github.v3+json',
                },
              }
            )
          } catch {
            if (page === 1) failed.push(name)
            break
          }
          // A 403 (rate limit) / 404 (no access or repo moved) on the 1st page
          // is a repo failure, not the end of pagination: we record it.
          if (!res.ok) {
            if (page === 1) failed.push(name)
            break
          }
          const events = await res.json() as GitHubEvent[]
          if (events.length === 0) break
          all.push(...events)
          const oldest = events[events.length - 1]
          if (Date.now() - new Date(oldest.created_at).getTime() > MAX_DAYS * DAY_MS) break
        }
        return all
      }

      try {
        const all: GitHubEvent[] = []
        // Pool: we process the repos in batches of CONCURRENCY instead of all at once.
        for (let i = 0; i < repoList.length; i += CONCURRENCY) {
          const batch = repoList.slice(i, i + CONCURRENCY)
          const results = await Promise.allSettled(batch.map(fetchRepoEvents))
          for (const r of results) {
            if (r.status === 'fulfilled') all.push(...r.value)
          }
        }
        if (alive) {
          setEvents(all)
          setWarning(
            failed.length
              ? `Could not load ${failed.length} of ${repoList.length} repos (rate limit or no access)`
              : null
          )
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load stats')
      } finally {
        if (alive) setLoading(false)
      }
    }

    void load()
    return () => { alive = false }
  }, [repoNames, githubToken])

  const developers = useMemo(() => aggregateEvents(events, windowDays), [events, windowDays])
  const totalCommits = developers.reduce((s, d) => s + d.commits, 0)
  const totalPrsMerged = developers.reduce((s, d) => s + d.prsMerged, 0)
  const totalReviews = developers.reduce((s, d) => s + d.reviews, 0)
  const topDeveloper = developers[0] ?? null
  const recentPrs = useMemo(() => extractRecentPrs(events, windowDays), [events, windowDays])
  const mergeTimeHours = useMemo(() => medianMergeHours(events, windowDays), [events, windowDays])
  const prev = useMemo(() => windowTotals(events, windowDays, windowDays * 2), [events, windowDays])

  return {
    stats: {
      developers, totalCommits, totalPrsMerged, totalReviews, mergeTimeHours,
      topDeveloper, recentPrs,
      prevCommits: prev.commits, prevPrsMerged: prev.prsMerged,
    },
    loading,
    error,
    warning,
  }
}
