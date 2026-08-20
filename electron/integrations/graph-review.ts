// Pure decision transforms over a GraphRun. resetBranchForRerun is the single
// re-run mechanism shared by the auto-repair loop and the human "request
// changes": it rewinds the coder and everything downstream to 'queued' so the
// next planTick relaunches them, records the feedback for composeNodeInput to
// prepend, and bumps the review round. No fs/PTY — the caller kills the old
// panes and persists.
import type { GraphTemplate } from './graph-template'
import type { GraphRun, NodeRuntime } from './graph-runner'

/** Transitive descendants of the given node ids (following dependsOn edges). */
function descendantsOf(t: GraphTemplate, ids: string[]): Set<string> {
  const children = new Map<string, string[]>()
  for (const n of t.nodes) for (const d of n.dependsOn) {
    if (!children.has(d)) children.set(d, [])
    children.get(d)!.push(n.id)
  }
  const out = new Set<string>()
  const stack = [...ids]
  while (stack.length) {
    const cur = stack.pop()!
    for (const c of children.get(cur) ?? []) if (!out.has(c)) { out.add(c); stack.push(c) }
  }
  return out
}

/** Reset every coder node + its descendants to 'queued', attach `feedback` as a
 *  revisionNote on each coder, and bump `round`. Pure — returns a fresh run. */
export function resetBranchForRerun(t: GraphTemplate, run: GraphRun, feedback: string): GraphRun {
  const coders = t.nodes.filter((n) => n.role === 'coder').map((n) => n.id)
  const toReset = new Set<string>([...coders, ...descendantsOf(t, coders)])
  const nodes: Record<string, NodeRuntime> = {}
  for (const [id, rt] of Object.entries(run.nodes)) {
    if (!toReset.has(id)) { nodes[id] = rt; continue }
    nodes[id] = { state: 'queued' } // drop paneId/endedAt/verdict/exitCode
  }
  const revisionNotes = { ...(run.revisionNotes ?? {}) }
  for (const c of coders) revisionNotes[c] = feedback
  return { ...run, nodes, revisionNotes, round: run.round + 1 }
}
