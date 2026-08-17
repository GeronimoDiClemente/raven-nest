// Pure graph orchestration. Given a template and the current runtime state of
// each node (which the caller derives from real panes via agent-status.ts),
// compute the next actions: which nodes to launch, which gates resolve, which
// to skip after a failure, whether the graph is done, and what to emit to the
// bus. No fs / PTY / Electron — 100% unit-testable, same shape as
// agent-status.ts / automation-runner.ts.
import type { GraphTemplate } from './graph-template'
import type { DomainEvent } from './bus-types'

export type NodeRunState =
  | 'queued'        // not started; waiting on upstream
  | 'running'       // its terminal is working
  | 'needs_input'   // paused waiting on a human decision
  | 'blocked'       // a review reported a blocking concern
  | 'done'          // finished, handed off
  | 'failed'        // exited non-zero / errored
  | 'skipped'       // an upstream failure cut this branch

export interface NodeRuntime {
  state: NodeRunState
  paneId?: string      // pane/PTY running this node (kind 'agent')
  startedAt?: number
  endedAt?: number
  summary?: string     // one-liner for the card/inspector
  artifact?: string    // path of the handoff artifact it wrote
}

export interface GraphRun {
  runId: string
  ticketId: string
  templateId: string
  worktreePath: string  // shared worktree for the ticket
  branch: string
  nodes: Record<string, NodeRuntime>  // by node.id
  startedAt: number
}

export type GateState = 'waiting' | 'blocked' | 'passed'

export interface GraphAdvance {
  toStart: string[]     // agent nodes to launch + passed gates to resolve
  toSkip: string[]      // descendants of a failed node to mark 'skipped'
  events: DomainEvent[] // transitions to publish on the bus
  completed: boolean
  blockedOn: string[]   // nodes/gates waiting on the human
}

// States that mean a node has finished its run (successfully or not). A gate
// can only be evaluated once every upstream node reached one of these.
const RESOLVED: NodeRunState[] = ['done', 'needs_input', 'blocked', 'failed', 'skipped']

function stateOf(run: GraphRun, id: string): NodeRunState {
  return run.nodes[id]?.state ?? 'queued'
}

/** Agent nodes in 'queued' whose dependencies are all 'done' → ready to launch.
 *  Gate nodes are never returned here; advanceGraph resolves them instead. */
export function readyNodes(t: GraphTemplate, run: GraphRun): string[] {
  return t.nodes
    .filter(
      (n) =>
        n.kind === 'agent' &&
        stateOf(run, n.id) === 'queued' &&
        n.dependsOn.every((d) => stateOf(run, d) === 'done'),
    )
    .map((n) => n.id)
}

/** Barrier semantics for a fan-in gate:
 *  - 'waiting': some upstream node hasn't finished its run yet.
 *  - 'passed' : every upstream node is 'done' (clean) → unlock downstream.
 *  - 'blocked': all finished but ≥1 didn't end 'done' (needs_input/blocked/
 *    failed) → human-in-the-loop. */
export function gateState(t: GraphTemplate, run: GraphRun, gateId: string): GateState {
  const gate = t.nodes.find((n) => n.id === gateId)
  if (!gate) return 'waiting'
  const deps = gate.dependsOn.map((d) => stateOf(run, d))
  if (deps.some((s) => !RESOLVED.includes(s))) return 'waiting'
  return deps.every((s) => s === 'done') ? 'passed' : 'blocked'
}

/** Transitive descendants of any 'failed' node that haven't already finished —
 *  the branch a failure cuts off. */
function descendantsOfFailed(t: GraphTemplate, run: GraphRun): string[] {
  const failed = t.nodes.filter((n) => stateOf(run, n.id) === 'failed').map((n) => n.id)
  if (failed.length === 0) return []
  const children = new Map<string, string[]>()
  for (const n of t.nodes) {
    for (const d of n.dependsOn) {
      if (!children.has(d)) children.set(d, [])
      children.get(d)!.push(n.id)
    }
  }
  const skip = new Set<string>()
  const stack = [...failed]
  while (stack.length) {
    const cur = stack.pop()!
    for (const child of children.get(cur) ?? []) {
      const s = stateOf(run, child)
      if (s !== 'done' && s !== 'failed' && !skip.has(child)) {
        skip.add(child)
        stack.push(child)
      }
    }
  }
  return [...skip]
}

/** One orchestration tick: pure function of the current run state → the actions
 *  the caller should take and the events to publish. The caller applies the
 *  actions (start panes, mark gates done, skip nodes) and dedups persistent
 *  signals (gate_blocked/needs_input) across ticks — same set-before-emit care
 *  as worktree-signals.ts. `graph.node_done` is emitted by the caller on the
 *  real pane transition (it has the summary), not here. */
export function advanceGraph(t: GraphTemplate, run: GraphRun): GraphAdvance {
  const events: DomainEvent[] = []
  const toStart: string[] = []
  const blockedOn: string[] = []

  // 1. Agent nodes ready to launch now.
  for (const id of readyNodes(t, run)) {
    const node = t.nodes.find((n) => n.id === id)!
    toStart.push(id)
    events.push({ type: 'graph.node_started', ticketId: run.ticketId, nodeId: id, role: node.role })
  }

  // 2. Agent nodes paused on a human decision.
  for (const n of t.nodes) {
    if (n.kind === 'agent' && stateOf(run, n.id) === 'needs_input') {
      blockedOn.push(n.id)
      events.push({ type: 'graph.node_needs_input', ticketId: run.ticketId, nodeId: n.id, role: n.role })
    }
  }

  // 3. Gates: resolve the passed ones (→ toStart so the caller marks them done
  //    and unlocks downstream), surface the blocked ones.
  for (const g of t.nodes.filter((n) => n.kind === 'gate')) {
    const gs = gateState(t, run, g.id)
    if (gs === 'passed' && stateOf(run, g.id) !== 'done') {
      toStart.push(g.id)
    } else if (gs === 'blocked') {
      blockedOn.push(g.id)
      const blockedBy = g.dependsOn.filter((d) => stateOf(run, d) !== 'done')
      events.push({ type: 'graph.gate_blocked', ticketId: run.ticketId, gateId: g.id, blockedBy })
    }
  }

  // 4. Propagate a failure to its descendants.
  const toSkip = descendantsOfFailed(t, run)

  // 5. Completion: every node finished as done/skipped, with at least one done.
  const completed =
    t.nodes.every((n) => {
      const s = stateOf(run, n.id)
      return s === 'done' || s === 'skipped'
    }) && t.nodes.some((n) => stateOf(run, n.id) === 'done')
  if (completed) {
    events.push({ type: 'graph.completed', ticketId: run.ticketId, templateId: run.templateId })
  }

  return { toStart, toSkip, events, completed, blockedOn }
}
