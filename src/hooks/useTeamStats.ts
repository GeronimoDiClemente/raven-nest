import { useState, useEffect, useMemo } from 'react'

export interface DeveloperStats {
  login: string
  avatarUrl: string
  commits: number
  prsOpened: number
  prsMerged: number
  reviews: number          // PR reviews que ESTE dev le hizo a otros (PullRequestReviewEvent)
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
  /** Mediana de horas abierto→merge de los PRs mergeados en la ventana. null si no hubo. */
  mergeTimeHours: number | null
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
    // created_at/merged_at vienen en el objeto pull_request del Events API, sirven
    // para medir el tiempo abierto→merge sin llamadas extra.
    pull_request?: { merged?: boolean; title?: string; created_at?: string; merged_at?: string }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
// Ventana máxima que traemos de red (cubre 2× el período más largo, 30d, para deltas).
// El filtrado a 7/30 días se hace client-side, así togglear Week/Month no re-fetchea.
const MAX_DAYS = 60
// Límite de repos en paralelo, para no gatillar el secondary rate limit de GitHub.
const CONCURRENCY = 5
// Solo estos tipos de evento cuentan como "contribución" y crean una fila de developer.
// Sin esto, un WatchEvent/ForkEvent/comentario mete gente que no commiteó al roster.
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
    // Excluir eventos que no son contribución (stars, forks, comentarios) y bots,
    // para que no ensucien el roster / podium con filas de 0 commits.
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
 * Mediana de horas abierto→merge de los PRs mergeados dentro de la ventana.
 * Usa created_at/merged_at del payload del Events API (sin llamadas extra).
 * Mediana en vez de promedio: un PR viejo de días no distorsiona el número.
 * Devuelve null si ningún PR mergeado trae ambas fechas.
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

  // El fetch NO depende de windowDays: traemos MAX_DAYS de red una sola vez y
  // filtramos client-side a 7/30. Togglear Week/Month no vuelve a pegarle a GitHub.
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
          // Un 403 (rate limit) / 404 (sin acceso o repo movido) en la 1ª página
          // es una falla del repo, no fin de paginación: la registramos.
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
        // Pool: procesamos los repos en tandas de CONCURRENCY en vez de todos a la vez.
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
              ? `No se pudieron cargar ${failed.length} de ${repoList.length} repos (rate limit o sin acceso)`
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
