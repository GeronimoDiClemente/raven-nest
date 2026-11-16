// Provenance is not decoration: if Integrations is going to DECIDE from memories, a
// reader (human or agent) needs to know a claim came from an automated reviewer in a
// run that was later approved anyway, versus from a human rejecting the change.
import type { GraphRun } from './graph-runner'

export interface ProvenanceSource {
  nodeId?: string
  role?: string
  focus?: string
  /** Which CLI/agent produced this (GraphNode.agent, e.g. 'claude'/'codex') and
   *  which model it ran (GraphNode.model). Rendered so the identity of who
   *  wrote a claim survives into the memory's text — the reader only ever sees
   *  this as prose, never the structured save-input, so if it's not rendered
   *  here it's lost (see memory-bridge-design.md §5/§11 B-3). */
  agent?: string
  model?: string
  verdict?: 'blocking' | 'non-blocking' | 'human-approved' | 'human-rejected'
}

/** Spanish labels for the verdict shown in the block — spec §5 asks for
 *  "bloqueante | no bloqueante | aprobado por humano" so the provenance reads
 *  as Spanish prose, not a raw TS union value. The type stays in English
 *  (it's code); only the rendering is translated. */
const VEREDICTO_ES: Record<NonNullable<ProvenanceSource['verdict']>, string> = {
  blocking: 'bloqueante',
  'non-blocking': 'no bloqueante',
  'human-approved': 'aprobado por humano',
  'human-rejected': 'rechazado por humano',
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
  if (src.agent) lines.push(`Agente: ${src.agent}${src.model ? ` (${src.model})` : ''}`)
  lines.push(`Origen: run ${run.runId} · template ${run.templateId}`)
  // `run.round` is stored 0-indexed (graph-runner.ts: round 0 = the first pass,
  // no re-run yet). Displayed 1-indexed here — "Ronda: 1" for round 0 — to match
  // the human-facing round count used elsewhere in the bridge (memory-bridge.ts
  // runSummary/escalated/requestChanges all count rounds the same way).
  lines.push(`Branch: ${run.branch} · Ticket: ${run.ticketId} · Ronda: ${run.round + 1}`)
  if (src.verdict) lines.push(`Veredicto: ${VEREDICTO_ES[src.verdict]}`)
  lines.push(runLink(run.runId))
  return lines.join('\n')
}
