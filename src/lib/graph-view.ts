// Pure mapping from a role-graph + its runtime state to positioned nodes/edges
// for the drill-down canvas. Kept dependency-free and decoupled from the main
// process: the caller flattens a GraphTemplate + GraphRun into FlowInputNode[]
// and passes plain data, so the renderer never imports Electron code. React
// Flow (the eventual consumer) reads `position` + `data`; the pure layout is a
// longest-path rank (columns) + index-within-rank (rows), deterministic given
// the input order. A heavier engine (dagre/elkjs) can replace this later
// without touching callers — see the spec's open questions.

export type FlowNodeState =
  | 'queued' | 'running' | 'needs_input' | 'blocked' | 'done' | 'failed' | 'skipped'

export interface FlowInputNode {
  id: string
  role: string
  kind: 'agent' | 'gate'
  focus?: string
  dependsOn: string[]
  state: FlowNodeState
}

export interface RFNode {
  id: string
  position: { x: number; y: number }
  data: { role: string; focus?: string; kind: 'agent' | 'gate'; state: FlowNodeState }
}

export interface RFEdge {
  id: string
  source: string
  target: string
}

export interface FlowLayoutOptions {
  colWidth?: number
  rowHeight?: number
}

export function toFlow(input: FlowInputNode[], opts: FlowLayoutOptions = {}): { nodes: RFNode[]; edges: RFEdge[] } {
  const colWidth = opts.colWidth ?? 220
  const rowHeight = opts.rowHeight ?? 96
  const byId = new Map(input.map((n) => [n.id, n]))

  // Longest-path rank = column. Guarded against cycles (templates are validated
  // acyclic upstream, but a stray input must not blow the stack).
  const rankMemo = new Map<string, number>()
  const rankOf = (id: string, onStack: Set<string> = new Set()): number => {
    const cached = rankMemo.get(id)
    if (cached !== undefined) return cached
    if (onStack.has(id)) return 0
    onStack.add(id)
    const deps = byId.get(id)?.dependsOn ?? []
    const r = deps.length === 0 ? 0 : Math.max(...deps.map((d) => rankOf(d, onStack))) + 1
    onStack.delete(id)
    rankMemo.set(id, r)
    return r
  }

  const ranked = input.map((node) => ({ node, rank: rankOf(node.id) }))

  // Row index within a rank (stable = input order), used for the y position.
  const rowIndex = new Map<string, number>()
  const perRank = new Map<number, number>()
  for (const { node, rank } of ranked) {
    const i = perRank.get(rank) ?? 0
    rowIndex.set(node.id, i)
    perRank.set(rank, i + 1)
  }

  const nodes: RFNode[] = ranked.map(({ node, rank }) => ({
    id: node.id,
    position: { x: rank * colWidth, y: (rowIndex.get(node.id) ?? 0) * rowHeight },
    data: { role: node.role, focus: node.focus, kind: node.kind, state: node.state },
  }))

  const edges: RFEdge[] = []
  for (const n of input) {
    for (const d of n.dependsOn) {
      edges.push({ id: `${d}->${n.id}`, source: d, target: n.id })
    }
  }

  return { nodes, edges }
}
