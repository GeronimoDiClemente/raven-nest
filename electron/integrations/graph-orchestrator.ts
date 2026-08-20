// Pure orchestration core for the per-ticket role-graph. This is the "brain of
// the tick" that main.ts drives: it takes sampled pane states, folds them into
// the GraphRun, asks graph-runner what to do next, and returns the concrete
// actions (panes to launch with composed inputs, gates to resolve, events to
// emit). No fs / PTY / Electron here — the caller injects the clock and an
// artifact reader and performs the real effects. Mirrors the pure-core pattern
// of agent-status.ts / automation-runner.ts.
import type { GraphTemplate, GraphNode } from './graph-template'
import type { GraphRun, NodeRunState, NodeRuntime } from './graph-runner'
import { advanceGraph, gateState } from './graph-runner'
import type { AgentState } from './agent-status'
import { composeNodeInput, artifactPath, type UpstreamArtifact } from './graph-handoff'
import type { DomainEvent } from './bus-types'
import type { WorkerAgent } from './worker-spec-store'
import { parseVerdict, type Verdict } from './graph-verdict'
import { applyDecision, resetBranchForRerun } from './graph-review'

const TERMINAL: ReadonlySet<NodeRunState> = new Set<NodeRunState>(['done', 'failed', 'skipped'])

/** A pane's coarse AgentState (4) → a node's richer NodeRunState (7). A pane
 *  that is idle is still alive, so the node stays 'running'; failed/blocked are
 *  decided elsewhere (exit code / a reviewer's verdict), never from a sample. */
export function mapAgentState(a: AgentState): NodeRunState {
  switch (a) {
    case 'working':
      return 'running'
    case 'idle':
      return 'running'
    case 'needs_input':
      return 'needs_input'
    case 'done':
      return 'done'
  }
}

/** Fold sampled pane states into the run. Only live (non-terminal) nodes that
 *  were actually sampled change; a node that just finished gets `endedAt`.
 *  Pure — returns a fresh run, never mutates the input. */
export function syncNodeStates(run: GraphRun, samples: Record<string, AgentState>, now: number): GraphRun {
  const nodes: Record<string, NodeRuntime> = {}
  for (const [id, rt] of Object.entries(run.nodes)) {
    const sample = samples[id]
    if (sample === undefined || TERMINAL.has(rt.state)) {
      nodes[id] = rt
      continue
    }
    const next = mapAgentState(sample)
    if (next === rt.state) {
      nodes[id] = rt
      continue
    }
    const updated: NodeRuntime = { ...rt, state: next }
    if (next === 'done') updated.endedAt = now
    nodes[id] = updated
  }
  return { ...run, nodes }
}

/** A pane the caller must launch for a ready agent node. */
export interface StartAction {
  nodeId: string
  paneId: string
  agent?: WorkerAgent
  model?: string
  effort?: 'low' | 'medium' | 'high'
  input: string // composed handoff + role instructions for the CLI's first prompt
}

export interface OrchestratorPorts {
  now: number
  /** Read an upstream node's handoff artifact (relative to the run worktree). */
  readArtifact: (worktreePath: string, relPath: string) => string | null
  maxReviewRounds: number                       // auto-repair retry cap
  exitCode?: (paneId: string) => number | null | undefined  // last pane exit code
}

export interface TickPlan {
  run: GraphRun // next run: sampled states folded in, starts/skips/gates applied
  start: StartAction[] // agent panes the caller must spawn this tick
  events: DomainEvent[] // node_done (from sampled transitions) + advanceGraph's
  completed: boolean
  blockedOn: string[]
}

/** True when no other node depends on this one (a DAG sink → writes no artifact). */
function isLeaf(t: GraphTemplate, nodeId: string): boolean {
  return !t.nodes.some((n) => n.dependsOn.includes(nodeId))
}

/** Collect the handoff artifacts feeding a node, hopping over gates (which write
 *  nothing) to the agent nodes behind them. Missing artifacts are skipped. */
function upstreamArtifacts(t: GraphTemplate, node: GraphNode, ports: OrchestratorPorts, worktreePath: string): UpstreamArtifact[] {
  const byId = new Map(t.nodes.map((n) => [n.id, n]))
  const out: UpstreamArtifact[] = []
  const visit = (depId: string) => {
    const dep = byId.get(depId)
    if (!dep) return
    if (dep.kind === 'gate') {
      for (const d of dep.dependsOn) visit(d)
      return
    }
    const content = ports.readArtifact(worktreePath, artifactPath(dep))
    if (content === null) return
    const ua: UpstreamArtifact = { role: dep.role, content }
    if (dep.focus !== undefined) ua.focus = dep.focus
    out.push(ua)
  }
  for (const depId of node.dependsOn) visit(depId)
  return out
}

/** Persistent signals (a gate staying blocked, a node staying needs_input) are
 *  re-derived every tick while the condition holds, so emitting them raw would
 *  spam the team. Dedupe by a stable key against a caller-persisted set (same
 *  contract as worktree-signals' ciNotified/reviewNotified). Transient
 *  transitions (started/done/completed) always pass — they fire once by nature.
 *  Pure: returns fresh events + a new set, never mutates `seen`. */
export function dedupePersistentSignals(events: DomainEvent[], seen: ReadonlySet<string>): { fresh: DomainEvent[]; seen: Set<string> } {
  const next = new Set(seen)
  const fresh: DomainEvent[] = []
  for (const ev of events) {
    let key: string | null = null
    if (ev.type === 'graph.gate_blocked') key = `gate_blocked:${ev.ticketId}:${ev.gateId}`
    else if (ev.type === 'graph.node_needs_input') key = `needs_input:${ev.ticketId}:${ev.nodeId}`
    if (key === null) {
      fresh.push(ev)
      continue
    }
    if (next.has(key)) continue
    next.add(key)
    fresh.push(ev)
  }
  return { fresh, seen: next }
}

/** One orchestration step. Sample → sync → advance → materialize actions. */
export function planTick(t: GraphTemplate, run: GraphRun, samples: Record<string, AgentState>, ports: OrchestratorPorts): TickPlan {
  const byId = new Map(t.nodes.map((n) => [n.id, n]))
  const synced = syncNodeStates(run, samples, ports.now)

  // Verdict pass: a reviewer whose pane just finished (sample→done) has its
  // verdict artifact read now. blocking:true (or a missing/unparseable verdict)
  // overrides the node to 'blocked'; a clean verdict stays 'done'. The Verdict
  // is attached for the card. Non-reviewer nodes are untouched.
  const withVerdicts: Record<string, NodeRuntime> = { ...synced.nodes }
  for (const [id, rt] of Object.entries(synced.nodes)) {
    const node = byId.get(id)
    if (!node || node.role !== 'reviewer') continue
    const justDone = rt.state === 'done' && run.nodes[id]?.state !== 'done'
    if (!justDone) continue
    const parsed = parseVerdict(ports.readArtifact(run.worktreePath, artifactPath(node)))
    const verdict: Verdict = parsed ?? { concerns: ['reviewer produced no parseable verdict'], blocking: true }
    withVerdicts[id] = { ...rt, verdict, state: verdict.blocking ? 'blocked' : 'done' }
  }
  const synced2 = { ...synced, nodes: withVerdicts }

  // Nodes whose pane just finished → node_done (advanceGraph never emits this;
  // it's the real transition the caller owns, carrying an optional summary).
  const doneEvents: DomainEvent[] = []
  for (const [id, rt] of Object.entries(synced2.nodes)) {
    if (rt.state === 'done' && run.nodes[id]?.state !== 'done') {
      const node = byId.get(id)
      if (node) doneEvents.push({ type: 'graph.node_done', ticketId: run.ticketId, nodeId: id, role: node.role })
    }
  }

  // Apply any queued human decision (approve/requestChanges) before advancing,
  // so an approve unblocks the gate this same tick and a requestChanges rewind
  // is what advanceGraph reasons about next. Single-writer: the IPC handlers
  // only ever set pendingDecision; the tick is the sole place that applies it.
  const decided = synced2.pendingDecision ? applyDecision(t, synced2) : synced2

  const adv = advanceGraph(t, decided)

  // Auto-repair (mode 'auto'): a blocked gate under the retry cap rewinds the
  // coder branch with the aggregated blocking concerns instead of waiting for a
  // human. At the cap it escalates (emits graph.escalated + stays blocked).
  if (decided.mode === 'auto') {
    const blockedGate = t.nodes.find(
      (n) => n.kind === 'gate' && gateState(t, decided, n.id) === 'blocked',
    )
    if (blockedGate) {
      if (decided.round < ports.maxReviewRounds) {
        const feedback = blockedGate.dependsOn
          .map((d) => decided.nodes[d]?.verdict?.concerns ?? [])
          .flat().join('; ') || 'address the blocking review concerns'
        const rerun = resetBranchForRerun(t, decided, feedback)
        return { run: rerun, start: [], events: [...doneEvents], completed: false, blockedOn: [] }
      }
      // at cap → escalate (fall through to normal advance, add the event)
      adv.events.push({ type: 'graph.escalated', ticketId: decided.ticketId, gateId: blockedGate.id, round: decided.round })
    }
  }

  const nodes: Record<string, NodeRuntime> = { ...decided.nodes }
  const start: StartAction[] = []
  const heldGates: string[] = [] // gates held for human approval (gate/step mode)

  for (const id of adv.toSkip) {
    nodes[id] = { ...nodes[id], state: 'skipped' }
  }

  for (const id of adv.toStart) {
    const node = byId.get(id)
    if (!node) continue
    if (node.kind === 'gate') {
      // A passed gate has no pane. In 'auto' mode resolve it immediately so
      // downstream unblocks next tick; in 'gate'/'step' mode hold it for a
      // human decision instead of auto-resolving.
      if (decided.mode === 'auto') {
        nodes[id] = { ...nodes[id], state: 'done', endedAt: ports.now }
      } else {
        heldGates.push(id)
      }
      continue
    }
    const paneId = `${run.runId}:${id}`
    nodes[id] = { ...nodes[id], state: 'running', paneId, startedAt: ports.now }
    const input = composeNodeInput(node, upstreamArtifacts(t, node, ports, run.worktreePath), isLeaf(t, id), decided.revisionNotes?.[id])
    const action: StartAction = { nodeId: id, paneId, input }
    if (node.agent !== undefined) action.agent = node.agent
    if (node.model !== undefined) action.model = node.model
    if (node.effort !== undefined) action.effort = node.effort
    start.push(action)
  }

  return {
    run: { ...decided, nodes },
    start,
    events: [...doneEvents, ...adv.events],
    completed: adv.completed,
    blockedOn: [...adv.blockedOn, ...heldGates],
  }
}
