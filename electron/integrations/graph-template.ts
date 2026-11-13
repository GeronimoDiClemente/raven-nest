// Graph template model for role-graph orchestration. A template is a DAG of
// role nodes (Architect → Coder → N Reviewers → Gate → Tester) expressed by
// each node's `dependsOn` (incoming edges). Fan-out = several nodes sharing a
// dependsOn; fan-in/gate = a `kind:'gate'` node whose dependsOn are the N
// reviewers. Pure module: types + built-in templates + validation only (no fs).
import type { WorkerAgent } from './worker-spec-store'

export type GraphRole = 'architect' | 'coder' | 'reviewer' | 'tester' | (string & {})
export type GraphNodeKind = 'agent' | 'gate'

export interface GraphNode {
  id: string
  role: GraphRole
  kind: GraphNodeKind
  agent?: WorkerAgent // for kind 'agent': which CLI runs this node
  model?: string // model-per-task
  effort?: 'low' | 'medium' | 'high'
  focus?: string // e.g. 'security' — distinguishes nodes of the same role
  instructions?: string // override; derived from role when absent
  dependsOn: string[] // upstream node ids (fan-in = multiple)
}

export interface GraphTemplate {
  id: string
  name: string
  description?: string
  builtIn?: boolean // true on the 3 seeds; an edited copy is builtIn=false
  nodes: GraphNode[]
  createdAt: number
  updatedAt: number
}

/** DFS 3-color cycle detection over the dependsOn edges (unknown ids ignored,
 *  so it is safe to call before the dangling-ref check). */
export function hasCycle(nodes: GraphNode[]): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const color = new Map<string, 1 | 2>() // 1 grey (on stack), 2 black (done)
  const visit = (id: string): boolean => {
    if (color.get(id) === 1) return true
    if (color.get(id) === 2) return false
    color.set(id, 1)
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dep) && visit(dep)) return true
    }
    color.set(id, 2)
    return false
  }
  return nodes.some((n) => visit(n.id))
}

const KINDS: GraphNodeKind[] = ['agent', 'gate']

function toNode(x: unknown): GraphNode | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.role !== 'string') return null
  if (typeof r.kind !== 'string' || !KINDS.includes(r.kind as GraphNodeKind)) return null
  if (!Array.isArray(r.dependsOn) || !r.dependsOn.every((d) => typeof d === 'string')) return null
  const out: GraphNode = {
    id: r.id,
    role: r.role,
    kind: r.kind as GraphNodeKind,
    dependsOn: r.dependsOn as string[],
  }
  if (typeof r.agent === 'string') out.agent = r.agent as WorkerAgent
  if (typeof r.model === 'string') out.model = r.model
  if (r.effort === 'low' || r.effort === 'medium' || r.effort === 'high') out.effort = r.effort
  if (typeof r.focus === 'string') out.focus = r.focus
  if (typeof r.instructions === 'string') out.instructions = r.instructions
  return out
}

/** Validate a template (unknown → typed | null). Rejects: bad shape, a node
 *  that failed to parse (so partial corruption drops the whole template rather
 *  than silently shrinking a DAG), empty node list, duplicate ids, a dependsOn
 *  referencing a missing id, or a cycle. */
export function toGraphTemplate(x: unknown): GraphTemplate | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || !Array.isArray(r.nodes)) return null
  const nodes = r.nodes.map(toNode).filter((n): n is GraphNode => n !== null)
  if (nodes.length === 0 || nodes.length !== r.nodes.length) return null
  const ids = new Set(nodes.map((n) => n.id))
  if (ids.size !== nodes.length) return null
  for (const n of nodes) for (const d of n.dependsOn) if (!ids.has(d)) return null
  if (hasCycle(nodes)) return null
  const out: GraphTemplate = {
    id: r.id,
    name: r.name,
    nodes,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  }
  if (typeof r.description === 'string') out.description = r.description
  if (r.builtIn === true) out.builtIn = true
  return out
}

/** The 3 seed templates (builtIn:true). Editing one saves a copy with a new id
 *  and builtIn:false, so the seed always stays available as a base. */
export function defaultGraphTemplates(): GraphTemplate[] {
  const t = (id: string, name: string, nodes: GraphNode[]): GraphTemplate => ({
    id,
    name,
    builtIn: true,
    nodes,
    createdAt: 0,
    updatedAt: 0,
  })
  return [
    t('full', 'Full pipeline', [
      { id: 'architect', role: 'architect', kind: 'agent', agent: 'claude', dependsOn: [] },
      { id: 'coder', role: 'coder', kind: 'agent', agent: 'codex', dependsOn: ['architect'] },
      { id: 'rev-security', role: 'reviewer', kind: 'agent', agent: 'claude', focus: 'security', dependsOn: ['coder'] },
      { id: 'rev-types', role: 'reviewer', kind: 'agent', agent: 'claude', focus: 'types', dependsOn: ['coder'] },
      { id: 'rev-perf', role: 'reviewer', kind: 'agent', agent: 'claude', focus: 'performance', dependsOn: ['coder'] },
      { id: 'gate', role: 'gate', kind: 'gate', dependsOn: ['rev-security', 'rev-types', 'rev-perf'] },
      { id: 'tester', role: 'tester', kind: 'agent', agent: 'claude', dependsOn: ['gate'] },
    ]),
    t('quick-fix', 'Quick fix', [
      { id: 'coder', role: 'coder', kind: 'agent', agent: 'codex', dependsOn: [] },
      { id: 'reviewer', role: 'reviewer', kind: 'agent', agent: 'claude', dependsOn: ['coder'] },
      { id: 'tester', role: 'tester', kind: 'agent', agent: 'claude', dependsOn: ['reviewer'] },
    ]),
    t('review-only', 'Review only', [
      { id: 'rev-1', role: 'reviewer', kind: 'agent', agent: 'claude', dependsOn: [] },
      { id: 'rev-2', role: 'reviewer', kind: 'agent', agent: 'claude', dependsOn: [] },
      { id: 'gate', role: 'gate', kind: 'gate', dependsOn: ['rev-1', 'rev-2'] },
    ]),
  ]
}
