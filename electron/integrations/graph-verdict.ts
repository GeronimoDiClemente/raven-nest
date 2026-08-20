// Parse a reviewer's handoff verdict (.nest/graph/review-<focus>.json). The
// reviewer is prompted (graph-handoff.roleDefault) to emit {concerns, blocking}.
// Pure: string|null → Verdict|null. A missing artifact (null) or any shape that
// isn't a real verdict returns null so the caller applies its own policy
// (graph-orchestrator treats null as blocking — never "no verdict = no objection").
export interface Verdict {
  concerns: string[]
  blocking: boolean
}

export function parseVerdict(raw: string | null): Verdict | null {
  if (raw === null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const r = data as Record<string, unknown>
  if (typeof r.blocking !== 'boolean') return null
  const concerns = Array.isArray(r.concerns) ? r.concerns.filter((c): c is string => typeof c === 'string') : []
  return { concerns, blocking: r.blocking }
}
