/** Signed % change vs the previous period. null when there is no baseline (prev = 0). */
export function trendVsPrev(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

export interface PrFile { path: string; additions?: number | null; deletions?: number | null }
export interface FiledPr { files: PrFile[] }

/** Aggregates PR files into top directories by lines changed (additions+deletions). */
export function topAreasFromFiles(prs: FiledPr[], topN: number): Array<{ dir: string; lines: number }> {
  const byDir = new Map<string, number>()
  for (const pr of prs) {
    for (const f of pr.files) {
      const dir = f.path.split('/').slice(0, 2).join('/')
      const lines = (f.additions ?? 0) + (f.deletions ?? 0)
      byDir.set(dir, (byDir.get(dir) ?? 0) + lines)
    }
  }
  return [...byDir.entries()]
    .map(([dir, lines]) => ({ dir, lines }))
    .sort((a, b) => b.lines - a.lines)
    .slice(0, topN)
}

const DAY_MS = 24 * 60 * 60 * 1000

interface MinEvent {
  type: string
  actor: { login: string }
  created_at: string
  payload: { commits?: unknown[]; action?: string; pull_request?: { merged?: boolean } }
}

/** Per-login commits + merged PRs in the PREVIOUS window [windowDays, 2*windowDays). */
export function perLoginPrev(
  events: MinEvent[],
  windowDays: number,
): Record<string, { commits: number; prsMerged: number }> {
  const out: Record<string, { commits: number; prsMerged: number }> = {}
  for (const e of events) {
    const ageDays = (Date.now() - new Date(e.created_at).getTime()) / DAY_MS
    if (ageDays < windowDays || ageDays >= windowDays * 2) continue
    const login = e.actor.login
    if (login.endsWith('[bot]')) continue
    const row = (out[login] ??= { commits: 0, prsMerged: 0 })
    if (e.type === 'PushEvent') row.commits += e.payload.commits?.length ?? 0
    else if (e.type === 'PullRequestEvent' && e.payload.action === 'closed' && e.payload.pull_request?.merged) row.prsMerged++
  }
  return out
}
