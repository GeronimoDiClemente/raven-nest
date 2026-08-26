// Pure translation of bus events + persisted GraphRun state into memory writes.
// The bus says WHEN; the run store says WHAT (NodeRuntime already carries the parsed
// verdict, summary, artifact path and exitCode — graph-runner.ts:26-35), so this module
// never touches the filesystem.
import type { DomainEvent } from './bus-types'
import type { GraphRun } from './graph-runner'
import type { GraphTemplate, GraphNode } from './graph-template'
import type { MemorySaveInput, MemoryObservationType } from './memory-port'
import { provenanceBlock } from './memory-provenance'

export interface BridgeContext {
  getRun(ticketId: string): GraphRun | null
  getTemplate(templateId: string): GraphTemplate | null
}

/** A reviewer whose focus is about correctness produces a bugfix-flavoured memory;
 *  anything else (perf, types, style) is a discovery. */
const CORRECTNESS_FOCUS = new Set(['security', 'correctness', 'bugs', 'logic'])

function typeForReviewer(node: GraphNode | undefined): MemoryObservationType {
  return node?.focus && CORRECTNESS_FOCUS.has(node.focus) ? 'bugfix' : 'discovery'
}

function cwdOf(run: GraphRun): string {
  return run.repoPath ?? run.worktreePath
}

export function bridgeEvent(ev: DomainEvent, ctx: BridgeContext): MemorySaveInput[] {
  switch (ev.type) {
    case 'graph.gate_blocked': {
      const run = ctx.getRun(ev.ticketId)
      if (!run) return []
      const template = ctx.getTemplate(run.templateId)
      const out: MemorySaveInput[] = []
      for (const nodeId of ev.blockedBy) {
        const rt = run.nodes[nodeId]
        if (!rt?.verdict?.blocking) continue
        const node = template?.nodes.find((n) => n.id === nodeId)
        rt.verdict.concerns.forEach((concern, i) => {
          out.push({
            cwd: cwdOf(run),
            title: concern.slice(0, 120),
            content: `${concern}\n\n${provenanceBlock(run, {
              nodeId, role: node?.role, focus: node?.focus, verdict: 'blocking',
            })}`,
            type: typeForReviewer(node),
            tags: [node?.focus, node?.role, 'graph'].filter((t): t is string => !!t),
            // No `round` in this key on purpose, and it's only safe because
            // dedupePersistentSignals (graph-orchestrator.ts) dedupes gate_blocked by
            // `${ticketId}:${gateId}` without the round, so a (ticket, gate) pair emits
            // this event once per run's lifetime. If that dedup key ever changed to
            // re-notify a gate, a second batch of concerns for the same node would
            // silently overwrite the first here.
            sourceRef: `graph:${run.runId}:${nodeId}:${i}`,
            originAi: node?.agent,
            gitBranch: run.branch,
          })
        })
      }
      return out
    }
    case 'graph.escalated': {
      const run = ctx.getRun(ev.ticketId)
      if (!run) return []
      const notes = Object.entries(run.revisionNotes ?? {})
        .map(([nodeId, note]) => `- ${nodeId}: ${note}`)
        .join('\n')
      return [{
        cwd: cwdOf(run),
        title: `Auto-repair no convergio despues de ${ev.round} rondas`,
        content:
          `El ciclo de review y re-run llego al tope de rondas sin resolver los concerns. ` +
          `Requiere decision humana.\n\n` +
          (notes ? `Revisiones pedidas:\n${notes}\n\n` : '') +
          provenanceBlock(run, { verdict: 'blocking' }),
        type: 'discovery',
        tags: ['graph', 'escalation'],
        sourceRef: `graph:${run.runId}:escalated`,
        gitBranch: run.branch,
      }]
    }
    default:
      return []
  }
}
