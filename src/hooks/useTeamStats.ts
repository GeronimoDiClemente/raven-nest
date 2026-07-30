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
  /** Median open→merge hours of the PRs merged within the window (cycle time). null if none. */
  mergeTimeHours: number | null
  /** Median open→first-review hours within the window (review latency). null if none. */
  reviewLatencyHours: number | null
  /** Distribution of merged PRs by size (S/M/L/XL). */
  prSizes: PrSizeBuckets
  /** Fraction of merged PRs that got at least one review. */
  reviewCov: ReviewCoverage
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
    pull_request?: { merged?: boolean; title?: string; created_at?: string; merged_at?: string; number?: number; additions?: number; deletions?: number }
    review?: { state?: string; submitted_at?: string }
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

export interface PrSizeBuckets { s: number; m: number; l: number; xl: number }

/**
 * Distribution of merged PRs by lines changed (additions+deletions), read from
 * the Events API payload (no extra calls). This is the counter-metric to raw PR
 * throughput — small PRs review faster and safer, so "many PRs" is read against
 * "how big". PRs whose size the payload doesn't carry are skipped.
 * Buckets: S ≤ 50, M ≤ 200, L ≤ 500, XL > 500.
 */
export function prSizeBuckets(events: GitHubEvent[], windowDays = 7): PrSizeBuckets {
  const seen = new Set<string>()
  const out: PrSizeBuckets = { s: 0, m: 0, l: 0, xl: 0 }
  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    if (!isWithinWindow(event.created_at, windowDays)) continue
    if (event.type !== 'PullRequestEvent' || event.payload.action !== 'closed') continue
    const pr = event.payload.pull_request
    if (!pr?.merged) continue
    if (pr.additions == null && pr.deletions == null) continue
    const size = (pr.additions ?? 0) + (pr.deletions ?? 0)
    if (size <= 50) out.s++
    else if (size <= 200) out.m++
    else if (size <= 500) out.l++
    else out.xl++
  }
  return out
}

export interface ReviewCoverage { mergedTotal: number; reviewed: number; pct: number }

/**
 * Fraction of merged PRs (in the window) that received at least one review — the
 * quality counter-metric to review/merge speed, so "fast" can't mean
 * "unreviewed". Correlates merged PullRequestEvents with PullRequestReviewEvents
 * by repo+number. Lower-bound estimate: reviews outside the fetched window / cap
 * aren't visible.
 */
export function reviewCoverage(events: GitHubEvent[], windowDays = 7): ReviewCoverage {
  const seen = new Set<string>()
  const merged = new Set<string>()
  const reviewed = new Set<string>()
  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    if (!isWithinWindow(event.created_at, windowDays)) continue
    const repo = event.repo?.name ?? ''
    const pr = event.payload.pull_request
    if (pr?.number == null) continue
    const key = `${repo}#${pr.number}`
    if (event.type === 'PullRequestEvent' && event.payload.action === 'closed' && pr.merged) {
      merged.add(key)
    } else if (event.type === 'PullRequestReviewEvent' && event.payload.action === 'created') {
      reviewed.add(key)
    }
  }
  let count = 0
  for (const k of merged) if (reviewed.has(k)) count++
  return { mergedTotal: merged.size, reviewed: count, pct: merged.size ? count / merged.size : 0 }
}

/**
 * Median hours from a PR opening to its FIRST review — how long work waits on a
 * reviewer (review latency), the flow counterpart to cycle time. Groups review
 * events by repo+number, takes the earliest review per PR, and medians the
 * open→first-review gap. Reads pull_request.created_at and review.submitted_at
 * from the Events payload (no extra calls). null if none carries both stamps.
 */
export function medianReviewLatencyHours(events: GitHubEvent[], windowDays = 7): number | null {
  const seen = new Set<string>()
  const firstReview = new Map<string, { opened: number; reviewed: number }>()
  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    if (!isWithinWindow(event.created_at, windowDays)) continue
    if (event.type !== 'PullRequestReviewEvent' || event.payload.action !== 'created') continue
    const pr = event.payload.pull_request
    const submitted = event.payload.review?.submitted_at
    if (pr?.number == null || !pr.created_at || !submitted) continue
    const opened = new Date(pr.created_at).getTime()
    const reviewed = new Date(submitted).getTime()
    if (reviewed < opened) continue
    const key = `${event.repo?.name ?? ''}#${pr.number}`
    const prev = firstReview.get(key)
    if (!prev || reviewed < prev.reviewed) firstReview.set(key, { opened, reviewed })
  }
  const durs = [...firstReview.values()].map(v => (v.reviewed - v.opened) / 3_600_000)
  if (durs.length === 0) return null
  durs.sort((a, b) => a - b)
  const mid = Math.floor(durs.length / 2)
  return durs.length % 2 ? durs[mid] : (durs[mid - 1] + durs[mid]) / 2
}

// ── GitHub GraphQL → GitHubEvent adapter ─────────────────────────────────────
// The REST Events API (/repos/:o/:r/events) stopped returning the fields these
// metrics need: its PushEvent payload has no `commits` array and its
// PullRequestEvent carries only {base,head,id,number,url} — no merged flag,
// timestamps, or additions/deletions. So every metric read back 0/—. GraphQL
// DOES return them, so we fetch there and synthesize the same GitHubEvent shape
// the metric functions above already parse — the aggregation logic is unchanged.

export interface GqlCommit {
  oid: string
  committedDate: string
  author?: { user?: { login?: string | null } | null; avatarUrl?: string | null; name?: string | null } | null
}
export interface GqlReview {
  author?: { login?: string | null; avatarUrl?: string | null } | null
  submittedAt?: string | null
  state?: string
}
export interface GqlPullRequest {
  id: string
  number: number
  title?: string | null
  createdAt: string
  mergedAt?: string | null
  additions?: number | null
  deletions?: number | null
  author?: { login?: string | null; avatarUrl?: string | null } | null
  reviews?: { nodes: GqlReview[] } | null
}

export function eventsFromGraphQL(
  repoName: string,
  data: { commits: GqlCommit[]; prs: GqlPullRequest[] },
): GitHubEvent[] {
  const events: GitHubEvent[] = []

  for (const c of data.commits) {
    // A commit with no linked GitHub account (unknown email) still counts toward
    // team throughput — fall back to the git author name so it isn't dropped.
    const login = c.author?.user?.login ?? c.author?.name ?? 'unknown'
    events.push({
      id: `commit:${c.oid}`,
      type: 'PushEvent',
      actor: { login, avatar_url: c.author?.avatarUrl ?? '' },
      repo: { name: repoName },
      created_at: c.committedDate,
      // One commit per event: aggregateEvents counts commits.length and buckets
      // by created_at, so per-commit events yield an accurate daily histogram.
      payload: { commits: [{ sha: c.oid, message: '' }] },
    })
  }

  for (const pr of data.prs) {
    if (pr.mergedAt) {
      const login = pr.author?.login ?? 'unknown'
      events.push({
        id: `pr:${repoName}#${pr.number}`,
        type: 'PullRequestEvent',
        actor: { login, avatar_url: pr.author?.avatarUrl ?? '' },
        repo: { name: repoName },
        created_at: pr.mergedAt,
        payload: {
          action: 'closed',
          pull_request: {
            merged: true,
            title: pr.title ?? undefined,
            number: pr.number,
            created_at: pr.createdAt,
            merged_at: pr.mergedAt,
            additions: pr.additions ?? undefined,
            deletions: pr.deletions ?? undefined,
          },
        },
      })
    }
    // Reviews correlate to their PR by repo#number (for coverage/latency),
    // independent of merge state. A pending review carries no submittedAt.
    const reviews = pr.reviews?.nodes ?? []
    reviews.forEach((rv, i) => {
      if (!rv.submittedAt) return
      const login = rv.author?.login ?? 'unknown'
      events.push({
        id: `review:${repoName}#${pr.number}:${i}`,
        type: 'PullRequestReviewEvent',
        actor: { login, avatar_url: rv.author?.avatarUrl ?? '' },
        repo: { name: repoName },
        created_at: rv.submittedAt,
        payload: {
          action: 'created',
          review: { state: rv.state, submitted_at: rv.submittedAt },
          pull_request: { number: pr.number, created_at: pr.createdAt },
        },
      })
    })
  }

  return events
}

interface GqlPageInfo { hasNextPage: boolean; endCursor: string | null }
interface CommitsResponse {
  repository: { defaultBranchRef: { target: { history?: { nodes: GqlCommit[]; pageInfo: GqlPageInfo } } | null } | null } | null
}
interface PrsResponse {
  repository: { pullRequests: { nodes: GqlPullRequest[]; pageInfo: GqlPageInfo } } | null
}

// Commits on the default branch (integrated work) within the window, with the
// author's GitHub login for the roster. `since` filters server-side.
const COMMITS_QUERY = `
query($owner:String!,$name:String!,$since:GitTimestamp!,$after:String){
  repository(owner:$owner,name:$name){
    defaultBranchRef{ target{ ... on Commit{
      history(since:$since, first:100, after:$after){
        nodes{ oid committedDate author{ user{ login } avatarUrl name } }
        pageInfo{ hasNextPage endCursor }
      }
    }}}
  }
}`

// Merged PRs with the fields the REST Events API drops: additions/deletions
// (size), created/merged timestamps (cycle time), and each review's submittedAt
// (latency + coverage).
const MERGED_PRS_QUERY = `
query($owner:String!,$name:String!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequests(states:MERGED, first:50, orderBy:{field:UPDATED_AT,direction:DESC}, after:$after){
      nodes{
        id number title createdAt mergedAt additions deletions
        author{ login avatarUrl }
        reviews(first:50){ nodes{ author{ login avatarUrl } submittedAt state } }
      }
      pageInfo{ hasNextPage endCursor }
    }
  }
}`

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

    const since = new Date(Date.now() - MAX_DAYS * DAY_MS).toISOString()

    const graphql = async (query: string, variables: Record<string, unknown>): Promise<unknown> => {
      const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `Bearer ${githubToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      })
      if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`)
      const json = (await res.json()) as { data: unknown; errors?: { message: string }[] }
      // A repo with no access surfaces as an errors[] entry (FORBIDDEN/NOT_FOUND);
      // treat it as a per-repo failure so the warning banner reflects it.
      if (json.errors?.length) throw new Error(json.errors[0]?.message ?? 'GraphQL error')
      return json.data
    }

    const load = async () => {
      const failed: string[] = []

      const fetchCommits = async (owner: string, name: string): Promise<GqlCommit[]> => {
        const out: GqlCommit[] = []
        let after: string | null = null
        // Cap at 3 pages (300 commits) within the window — matches the old fetch's cap.
        for (let page = 0; page < 3; page++) {
          const data = (await graphql(COMMITS_QUERY, { owner, name, since, after })) as CommitsResponse
          if (!data.repository) throw new Error('no repo access')
          const hist = data.repository.defaultBranchRef?.target?.history
          if (!hist) break // empty repo / no default branch → no commits (not a failure)
          out.push(...hist.nodes)
          if (!hist.pageInfo.hasNextPage) break
          after = hist.pageInfo.endCursor
        }
        return out
      }

      const fetchMergedPrs = async (owner: string, name: string): Promise<GqlPullRequest[]> => {
        const out: GqlPullRequest[] = []
        let after: string | null = null
        for (let page = 0; page < 3; page++) {
          const data = (await graphql(MERGED_PRS_QUERY, { owner, name, after })) as PrsResponse
          if (!data.repository) throw new Error('no repo access')
          const prs = data.repository.pullRequests
          out.push(...prs.nodes)
          if (!prs.pageInfo.hasNextPage) break
          // PRs come ordered by UPDATED_AT desc; stop once the oldest merge on the
          // page is past the window (the client-side filter is the real bound).
          const oldest = prs.nodes[prs.nodes.length - 1]?.mergedAt
          if (oldest && Date.now() - new Date(oldest).getTime() > MAX_DAYS * DAY_MS) break
          after = prs.pageInfo.endCursor
        }
        return out
      }

      const fetchRepoActivity = async (fullName: string): Promise<GitHubEvent[]> => {
        const [owner, name] = fullName.split('/')
        if (!owner || !name) { failed.push(fullName); return [] }
        try {
          const [commits, prs] = await Promise.all([fetchCommits(owner, name), fetchMergedPrs(owner, name)])
          return eventsFromGraphQL(fullName, { commits, prs })
        } catch {
          failed.push(fullName)
          return []
        }
      }

      try {
        const all: GitHubEvent[] = []
        // Pool: process the repos in batches of CONCURRENCY instead of all at once.
        for (let i = 0; i < repoList.length; i += CONCURRENCY) {
          const batch = repoList.slice(i, i + CONCURRENCY)
          const results = await Promise.allSettled(batch.map(fetchRepoActivity))
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
  const reviewLatencyHours = useMemo(() => medianReviewLatencyHours(events, windowDays), [events, windowDays])
  const prSizes = useMemo(() => prSizeBuckets(events, windowDays), [events, windowDays])
  const reviewCov = useMemo(() => reviewCoverage(events, windowDays), [events, windowDays])
  const prev = useMemo(() => windowTotals(events, windowDays, windowDays * 2), [events, windowDays])

  return {
    stats: {
      developers, totalCommits, totalPrsMerged, totalReviews, mergeTimeHours,
      reviewLatencyHours, prSizes, reviewCov,
      topDeveloper, recentPrs,
      prevCommits: prev.commits, prevPrsMerged: prev.prsMerged,
    },
    loading,
    error,
    warning,
  }
}
