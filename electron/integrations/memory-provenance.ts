// Provenance is not decoration: if Integrations is going to DECIDE from memories, a
// reader (human or agent) needs to know a claim came from an automated reviewer in a
// run that was later approved anyway, versus from a human rejecting the change.
import type { GraphRun } from './graph-runner'

export interface ProvenanceSource {
  nodeId?: string
  role?: string
  focus?: string
  verdict?: 'blocking' | 'non-blocking' | 'human-approved' | 'human-rejected'
}

/** Stable, syncId-free link every memory of a run carries, so they converge on one
 *  node in a graph view. The run-close memory declares the same alias. */
export function runLink(runId: string): string {
  return `[[run-${runId}]]`
}

export function provenanceBlock(run: GraphRun, src: ProvenanceSource): string {
  const lines = ['---']
  if (src.nodeId) {
    // A template lookup can miss (`nodes.find(...)` → undefined) and hand us a
    // nodeId with no role. Rendering `(undefined)` would be worse than omitting
    // the parens, so only append them once we actually have a role.
    const role = src.role ? (src.focus ? `${src.role}/${src.focus}` : src.role) : undefined
    lines.push(role ? `Nodo: ${src.nodeId} (${role})` : `Nodo: ${src.nodeId}`)
  }
  lines.push(`Origen: run ${run.runId} · template ${run.templateId}`)
  lines.push(`Branch: ${run.branch} · Ticket: ${run.ticketId} · Ronda: ${run.round}`)
  if (src.verdict) lines.push(`Veredicto: ${src.verdict}`)
  lines.push(runLink(run.runId))
  return lines.join('\n')
}
