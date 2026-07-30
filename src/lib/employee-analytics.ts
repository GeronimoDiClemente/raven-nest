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

const STUCK_DAYS = 4          // an open PR older than this with no review is "stuck"
const QUIET_DROP = 0.6        // >=60% fewer commits than last period → "quiet"

export interface OpenPrLite { createdAt: string; reviewCount: number }
export interface OpenPrSig { ageDays: number; stuck: boolean; awaitingReview: boolean }

export function openPrSignal(pr: OpenPrLite): OpenPrSig {
  const ageDays = Math.floor((Date.now() - new Date(pr.createdAt).getTime()) / DAY_MS)
  const awaitingReview = pr.reviewCount === 0
  return { ageDays, awaitingReview, stuck: awaitingReview && ageDays >= STUCK_DAYS }
}

export interface AttentionChip { cls: 'warn' | 'review'; text: string }

/** The list chip. Coaching signals only — never a rank/score. First match wins. */
export function attentionFor(
  dev: { commits: number; prevCommits: number },
  openPrs: OpenPrLite[],
  _viewerLogin: string,
): AttentionChip | null {
  const stuck = openPrs.map(openPrSignal).filter(s => s.stuck).sort((a, b) => b.ageDays - a.ageDays)[0]
  if (stuck) return { cls: 'warn', text: `PR stuck ${stuck.ageDays}d` }
  if (dev.prevCommits > 0 && dev.commits <= dev.prevCommits * (1 - QUIET_DROP)) {
    return { cls: 'warn', text: 'Quiet — activity down' }
  }
  const awaiting = openPrs.filter(p => openPrSignal(p).awaitingReview).length
  if (awaiting > 0) return { cls: 'review', text: `${awaiting} PR${awaiting > 1 ? 's' : ''} awaiting review` }
  return null
}
