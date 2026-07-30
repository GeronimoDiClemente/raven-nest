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
