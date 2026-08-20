// Parse a reviewer's handoff verdict (.nest/graph/review-<focus>.json). The
// reviewer is prompted (graph-handoff.roleDefault) to emit {concerns, blocking}.
// Pure: string|null → Verdict|null. A missing artifact (null) or any shape that
// isn't a real verdict returns null so the caller applies its own policy
// (graph-orchestrator treats null as blocking — never "no verdict = no objection").
//
// Tolerant by design: real LLM reviewers frequently WRAP the verdict in a
// richer object ({role, analysis, result:{concerns, blocking}}) instead of
// putting it at the top level (observed in the live smoke — it cost a wasted
// auto-repair round every run). So we accept a top-level verdict OR the first
// nested object that carries a boolean `blocking`, without loosening the "no
// boolean blocking anywhere → null" contract.
export interface Verdict {
  concerns: string[]
  blocking: boolean
}

function toConcerns(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((c): c is string => typeof c === 'string') : []
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

  // Prefer a top-level verdict (the shape we prompt for).
  if (typeof r.blocking === 'boolean') return { blocking: r.blocking, concerns: toConcerns(r.concerns) }

  // Otherwise look one level deep for the first object carrying a boolean
  // `blocking` (e.g. {result:{...}} / {verdict:{...}}); read its own concerns,
  // falling back to top-level concerns when the nested object omits them.
  for (const v of Object.values(r)) {
    if (v && typeof v === 'object') {
      const nested = v as Record<string, unknown>
      if (typeof nested.blocking === 'boolean') {
        return { blocking: nested.blocking, concerns: toConcerns(nested.concerns ?? r.concerns) }
      }
    }
  }
  return null
}
