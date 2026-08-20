// Structured handoff between graph nodes. The state that matters lives in the
// shared git worktree (the real diff); these artifacts carry the *structured*
// summary each role leaves for its downstream nodes (plan.md, review-*.json),
// so context is passed as versioned artifacts rather than replayed prose — the
// mitigation for the role-decomposition "telephone game" (see the spec §3).
// Pure: paths + input composition only (no fs). Extends worker-run.ts's
// composeStepInput to a fan-in graph.
import type { GraphNode } from './graph-template'

export interface UpstreamArtifact {
  role: string
  focus?: string
  content: string
}

/** Where a node writes its handoff artifact, relative to the worktree root.
 *  Reviewers emit structured JSON keyed by focus; everyone else a markdown note. */
export function artifactPath(node: GraphNode): string {
  if (node.role === 'reviewer') return `.nest/graph/review-${node.focus ?? node.id}.json`
  return `.nest/graph/${node.id}.md`
}

function roleDefault(node: GraphNode): string {
  switch (node.role) {
    case 'architect':
      return 'Plan the change: break it into concrete, ordered steps. Do not write code yet.'
    case 'coder':
      return 'Implement the change following the plan above. Keep the diff focused and self-contained.'
    case 'reviewer':
      return `Review the current diff for ${node.focus ?? 'correctness'}. Report your findings as JSON: {"concerns": [...], "blocking": true|false}.`
    case 'tester':
      return 'Run the test suite for the change and report pass/fail with any failing output.'
    default:
      return ''
  }
}

function label(u: UpstreamArtifact): string {
  return u.focus ? `${u.role} · ${u.focus}` : u.role
}

/** Build a node's input from its upstream nodes' structured artifacts: each is
 *  prepended labeled by role/focus, then the node's own instructions (or a role
 *  default), then — for non-leaf nodes — the instruction to write its artifact
 *  so downstream nodes can read it. `isLeaf` = the node has no dependents. */
export function composeNodeInput(node: GraphNode, upstream: UpstreamArtifact[], isLeaf: boolean, revisionNote?: string): string {
  const parts: string[] = []
  if (revisionNote) parts.push(`Revision requested: ${revisionNote}`)
  for (const u of upstream) parts.push(`Handoff from ${label(u)}:\n\n${u.content}`)
  const instructions = node.instructions ?? roleDefault(node)
  if (instructions) parts.push(instructions)
  if (!isLeaf) {
    parts.push(`When you finish, write your handoff artifact (what you did, findings, key files) to ${artifactPath(node)}.`)
  }
  return parts.join('\n\n')
}
