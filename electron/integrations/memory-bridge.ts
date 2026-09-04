// Pure translation of bus events + persisted GraphRun state into memory writes.
// The bus says WHEN; the run store says WHAT (NodeRuntime already carries the parsed
// verdict, summary, artifact path and exitCode — graph-runner.ts:26-35), so this module
// never touches the filesystem.
import type { DomainEvent } from './bus-types'
import type { GraphRun, PendingDecision } from './graph-runner'
import type { GraphTemplate, GraphNode } from './graph-template'
import type { MemorySaveInput, MemoryObservationType } from './memory-port'
import { provenanceBlock } from './memory-provenance'

export interface BridgeContext {
  /** Accepts either a ticketId (graph.* events) or a branch (pr.merged, which
   *  carries no ticketId). Whoever injects this context must resolve both. */
  getRun(key: string): GraphRun | null
  getTemplate(templateId: string): GraphTemplate | null
  /** Resolves a GitHub "owner/repo" full name to this device's local working
   *  directory for that repo, or null when there is none (repo never cloned
   *  locally on this machine, or the caller only knows the full name and not
   *  a device-local path). Used to give a real `cwd` to memories triggered by
   *  events that carry a repo full name but no local path of their own. */
  resolveRepo(repoFullName: string): string | null
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

function runSummary(run: GraphRun, merged: boolean): string {
  const done = Object.entries(run.nodes).filter(([, rt]) => rt.state === 'done').map(([id]) => id)
  const concerns = Object.entries(run.nodes)
    .flatMap(([id, rt]) => (rt.verdict?.blocking ? rt.verdict.concerns.map((c) => `- ${id}: ${c}`) : []))
  return [
    // `run.round` is 0-indexed (round 0 = first pass); +1 here for the human
    // count, matching provenanceBlock's "Ronda:" line below and the other
    // round mentions in this module (escalated, requestChanges) — see
    // memory-provenance.ts for the full note.
    `Ticket ${run.ticketId} · template ${run.templateId} · ${run.round + 1} ronda(s).`,
    `Nodos completados: ${done.join(', ') || 'ninguno'}.`,
    concerns.length ? `Concerns bloqueantes durante el run:\n${concerns.join('\n')}` : 'Sin concerns bloqueantes.',
    merged ? `Mergeado a ${run.branch}: el cambio sobrevivió.` : '',
    provenanceBlock(run, {}),
  ].filter(Boolean).join('\n\n')
}

function runCloseMemory(run: GraphRun, merged: boolean): MemorySaveInput {
  return {
    cwd: cwdOf(run),
    title: `Run ${run.templateId} · ticket ${run.ticketId}`,
    content: runSummary(run, merged),
    type: 'session',
    tags: ['graph', 'run'],
    sourceRef: `graph:${run.runId}:run`,
    gitBranch: run.branch,
  }
}

/** Deterministic fallback key for `ci.failed` when there is no `runUrl` to disambiguate on:
 *  same summary on the same branch = same fact (the same test failing again) and must
 *  collapse into one memory; different summary = different fact and must stay separate.
 *  Never derive this from a timestamp — that breaks determinism and turns a re-emitted
 *  event into a brand-new memory every time, defeating the point of the sourceRef upsert. */
function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  // A summary with no alphanumeric chars (e.g. all emoji/punctuation) slugs to
  // '', which would collapse every such ci.failed into the same sourceRef.
  return s || 'sin-summary'
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
        // `blockedBy` lists every gate dependency that isn't 'done' yet (see
        // gateState in graph-runner.ts) — that includes dependencies still
        // running/queued this tick and ones that failed outright, not only
        // ones with a parsed blocking verdict. A dependency with no blocking
        // verdict here is the expected case for those, not a bug to chase:
        // there is nothing to write yet, so this produces nothing.
        if (!rt?.verdict?.blocking) continue
        const node = template?.nodes.find((n) => n.id === nodeId)
        rt.verdict.concerns.forEach((concern, i) => {
          out.push({
            cwd: cwdOf(run),
            title: concern.slice(0, 120),
            content: `${concern}\n\n${provenanceBlock(run, {
              nodeId, role: node?.role, focus: node?.focus, agent: node?.agent, model: node?.model, verdict: 'blocking',
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
        // ev.round is 0-indexed like run.round; +1 for the human count (see
        // memory-provenance.ts).
        title: `Auto-repair no convergió después de ${ev.round + 1} rondas`,
        content:
          `El ciclo de review y re-run llegó al tope de rondas sin resolver los concerns. ` +
          `Requiere decisión humana.\n\n` +
          (notes ? `Revisiones pedidas:\n${notes}\n\n` : '') +
          provenanceBlock(run, { verdict: 'blocking' }),
        type: 'discovery',
        tags: ['graph', 'escalation'],
        // gateId in the key: a template with two gates escalating independently
        // must produce two memories, not collapse the second escalation into
        // the first (source_ref upsert would silently overwrite it otherwise).
        sourceRef: `graph:${run.runId}:escalated:${ev.gateId}`,
        gitBranch: run.branch,
      }]
    }
    case 'graph.completed': {
      const run = ctx.getRun(ev.ticketId)
      return run ? [runCloseMemory(run, false)] : []
    }

    case 'pr.merged': {
      const run = ctx.getRun(ev.branch)
      return run ? [runCloseMemory(run, true)] : []
    }

    case 'ci.failed': {
      if (!ev.summary) return []
      return [{
        cwd: ctx.resolveRepo(ev.repoFullName) ?? '',
        title: `CI en rojo · ${ev.branch}`,
        content: `${ev.summary}${ev.runUrl ? `\n\nRun: ${ev.runUrl}` : ''}\n\n---\nRepo: ${ev.repoFullName} · Branch: ${ev.branch}`,
        type: 'bugfix',
        tags: ['ci', 'graph'],
        sourceRef: `ci:${ev.repoFullName}:${ev.branch}:${ev.runUrl ?? slug(ev.summary)}`,
        gitBranch: ev.branch,
      }]
    }

    case 'error.detected': {
      if (!ev.summary) return []
      // Unlike ci.failed, ErrorDetectedEvent (bus-types.ts) carries no
      // repoFullName — `source`/`ref` are a generic error-tracker identity
      // (e.g. 'sentry'/'ISSUE-9'), not a repo. There is nothing to hand
      // ctx.resolveRepo, so cwd stays unresolved until this event's shape
      // grows a repo identifier.
      return [{
        cwd: '',
        title: `Error detectado · ${ev.source}`,
        content: `${ev.summary}\n\n---\nFuente: ${ev.source} · Ref: ${ev.ref}`,
        type: 'bugfix',
        tags: ['error', ev.source],
        sourceRef: `error:${ev.source}:${ev.ref}`,
      }]
    }

    default:
      return []
  }
}

/** Human judgement over machine judgement. This is the highest-value memory in the
 *  system and the one no MCP-only competitor can capture: an approve says "these
 *  concerns were not blocking in this context", which is what stops the reviewers
 *  from blocking on the same thing next run.
 *
 *  Decisions don't travel on the bus — the IPC handlers in main.ts only queue
 *  `run.pendingDecision` for planTick to apply later, so this takes the run
 *  directly instead of a DomainEvent (see Task 7 for where this gets called,
 *  before that overwrite happens). */
export function bridgeDecision(
  decision: PendingDecision,
  run: GraphRun,
  template: GraphTemplate | null,
): MemorySaveInput[] {
  if (decision.kind === 'approve') {
    const gate = template?.nodes.find((n) => n.id === decision.gateId)
    const overridden = (gate?.dependsOn ?? [])
      .flatMap((nodeId) => {
        const v = run.nodes[nodeId]?.verdict
        return v?.blocking ? v.concerns.map((c) => `- ${nodeId}: ${c}`) : []
      })
    if (overridden.length === 0) return []
    return [{
      cwd: cwdOf(run),
      title: `Aprobado a pesar de ${overridden.length} concern(s) bloqueante(s)`,
      content:
        `Un humano aprobó el gate ${decision.gateId} sabiendo que estos concerns estaban ` +
        `marcados como bloqueantes. En este contexto no lo eran:\n${overridden.join('\n')}\n\n` +
        provenanceBlock(run, { nodeId: decision.gateId, role: gate?.role, verdict: 'human-approved' }),
      type: 'decision',
      tags: ['graph', 'human-decision'],
      sourceRef: `graph:${run.runId}:approve:${decision.gateId}:${run.round}`,
      gitBranch: run.branch,
    }]
  }

  const feedback = decision.feedback.trim()
  if (!feedback) return []
  return [{
    cwd: cwdOf(run),
    // +1 for the human count, same convention as everywhere else in this module.
    title: `Cambios pedidos por un humano (ronda ${run.round + 1})`,
    content: `${feedback}\n\n${provenanceBlock(run, { verdict: 'human-rejected' })}`,
    type: 'decision',
    tags: ['graph', 'human-decision'],
    sourceRef: `graph:${run.runId}:changes:${run.round}`,
    gitBranch: run.branch,
  }]
}
