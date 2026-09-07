# Graph Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn integrations' "1 ticket → 1 linear worker" into "1 ticket → a role-graph of agents" (Architect → Coder → N Reviewers fan-out → Gate → Tester), with a pure, testable engine.

**Architecture:** Pure logic modules under `electron/integrations/` (mirroring `agent-status.ts`/`automation-runner.ts`: no fs/PTY/Electron in the core, caller injects state). DAG expressed by `dependsOn`. Runner computes ready nodes / gate barrier / human-in-the-loop from injected node states. UI (React Flow) mounts only on drill-down. Spec: `docs/superpowers/specs/2026-08-17-graph-orchestration-design.md`.

**Tech Stack:** TypeScript, vitest (node), `@xyflow/react` + `@dagrejs/dagre` (UI phase only). Reuses `WorkerAgent`, `AgentState`, the bus (`bus-types.ts`), and the atomic-store pattern (`worker-spec-store.ts`).

**Autonomy note:** Tasks 1–6 are pure and fully verifiable by tests (this run). Tasks 7+ (UI render, main wiring) need Gero's visual validation / a live smoke — scaffolded, not claimed done.

---

### Task 1: Graph template model + validation

**Files:**
- Create: `electron/integrations/graph-template.ts`
- Test: `electron/integrations/graph-template.test.ts`

- [ ] **Step 1: Failing test** — built-ins + validation + cycle detection

```ts
import { describe, it, expect } from 'vitest'
import { defaultGraphTemplates, toGraphTemplate, hasCycle, type GraphTemplate } from './graph-template'

describe('graph-template', () => {
  it('ships 3 built-in templates (full/quick-fix/review-only), all valid DAGs', () => {
    const ids = defaultGraphTemplates().map((t) => t.id).sort()
    expect(ids).toEqual(['full', 'quick-fix', 'review-only'])
    for (const t of defaultGraphTemplates()) {
      expect(t.builtIn).toBe(true)
      expect(toGraphTemplate(t)).not.toBeNull()
      expect(hasCycle(t.nodes)).toBe(false)
    }
  })

  it('full template fans out to 3 reviewers into a gate before the tester', () => {
    const full = defaultGraphTemplates().find((t) => t.id === 'full')!
    const reviewers = full.nodes.filter((n) => n.role === 'reviewer')
    const gate = full.nodes.find((n) => n.kind === 'gate')!
    const tester = full.nodes.find((n) => n.role === 'tester')!
    expect(reviewers).toHaveLength(3)
    expect(gate.dependsOn.sort()).toEqual(reviewers.map((r) => r.id).sort())
    expect(tester.dependsOn).toContain(gate.id)
  })

  it('toGraphTemplate rejects dangling dependsOn and cycles', () => {
    const dangling = { id: 'x', name: 'x', nodes: [{ id: 'a', role: 'coder', kind: 'agent', dependsOn: ['ghost'] }], createdAt: 0, updatedAt: 0 }
    expect(toGraphTemplate(dangling)).toBeNull()
    const cyclic = { id: 'y', name: 'y', nodes: [
      { id: 'a', role: 'coder', kind: 'agent', dependsOn: ['b'] },
      { id: 'b', role: 'tester', kind: 'agent', dependsOn: ['a'] },
    ], createdAt: 0, updatedAt: 0 }
    expect(toGraphTemplate(cyclic)).toBeNull()
  })

  it('hasCycle detects a back-edge', () => {
    expect(hasCycle([
      { id: 'a', role: 'coder', kind: 'agent', dependsOn: [] },
      { id: 'b', role: 'reviewer', kind: 'agent', dependsOn: ['a'] },
      { id: 'c', role: 'tester', kind: 'agent', dependsOn: ['b', 'a'] },
    ])).toBe(false)
    expect(hasCycle([
      { id: 'a', role: 'coder', kind: 'agent', dependsOn: ['c'] },
      { id: 'b', role: 'reviewer', kind: 'agent', dependsOn: ['a'] },
      { id: 'c', role: 'tester', kind: 'agent', dependsOn: ['b'] },
    ])).toBe(true)
  })
})
```

- [ ] **Step 2: Run → fails** (`npx vitest run electron/integrations/graph-template.test.ts`) — "Cannot find module".

- [ ] **Step 3: Implement** `graph-template.ts`

```ts
import type { WorkerAgent } from './worker-spec-store'

export type GraphRole = 'architect' | 'coder' | 'reviewer' | 'tester' | (string & {})
export type GraphNodeKind = 'agent' | 'gate'

export interface GraphNode {
  id: string
  role: GraphRole
  kind: GraphNodeKind
  agent?: WorkerAgent
  model?: string
  effort?: 'low' | 'medium' | 'high'
  focus?: string
  instructions?: string
  dependsOn: string[]
}

export interface GraphTemplate {
  id: string
  name: string
  description?: string
  builtIn?: boolean
  nodes: GraphNode[]
  createdAt: number
  updatedAt: number
}

/** DFS 3-color cycle detection over the dependsOn edges. */
export function hasCycle(nodes: GraphNode[]): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const color = new Map<string, 0 | 1 | 2>() // 0 white,1 grey,2 black
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
  const out: GraphNode = { id: r.id, role: r.role, kind: r.kind as GraphNodeKind, dependsOn: r.dependsOn as string[] }
  if (typeof r.agent === 'string') out.agent = r.agent as WorkerAgent
  if (typeof r.model === 'string') out.model = r.model
  if (r.effort === 'low' || r.effort === 'medium' || r.effort === 'high') out.effort = r.effort
  if (typeof r.focus === 'string') out.focus = r.focus
  if (typeof r.instructions === 'string') out.instructions = r.instructions
  return out
}

/** Validate a template (unknown → typed | null). Rejects: bad shape, empty
 *  nodes, duplicate ids, dependsOn referencing a missing id, or a cycle. */
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
    id: r.id, name: r.name, nodes,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  }
  if (typeof r.description === 'string') out.description = r.description
  if (r.builtIn === true) out.builtIn = true
  return out
}

export function defaultGraphTemplates(): GraphTemplate[] {
  const t = (id: string, name: string, nodes: GraphNode[]): GraphTemplate =>
    ({ id, name, builtIn: true, nodes, createdAt: 0, updatedAt: 0 })
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
```

- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** `git add electron/integrations/graph-template.ts electron/integrations/graph-template.test.ts && git commit -m "feat(graph): template model + DAG validation"`

---

### Task 2: Template store (atomic, built-in ⊕ custom)

**Files:**
- Create: `electron/integrations/graph-template-store.ts`
- Test: `electron/integrations/graph-template-store.test.ts`

Mirrors `worker-spec-store.ts` exactly (load: missing→built-ins only, corrupt→warn+built-ins; save: tmp+rename; drop invalid entries). `list()` returns built-ins followed by valid custom templates; `save`/`delete` operate on custom only.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { GraphTemplateStore } from './graph-template-store'

let dir: string, file: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gt-')); file = join(dir, 'graph-templates.json') })

describe('GraphTemplateStore', () => {
  it('lists the 3 built-ins when no file exists', () => {
    const s = new GraphTemplateStore(file)
    expect(s.list().map((t) => t.id).sort()).toEqual(['full', 'quick-fix', 'review-only'])
  })
  it('persists a custom template and lists it after built-ins', () => {
    const s = new GraphTemplateStore(file)
    s.save({ id: 'c1', name: 'Mine', nodes: [{ id: 'a', role: 'coder', kind: 'agent', dependsOn: [] }], createdAt: 1, updatedAt: 1 })
    const listed = new GraphTemplateStore(file).list()
    expect(listed.map((t) => t.id)).toContain('c1')
    expect(listed.filter((t) => t.builtIn).length).toBe(3)
  })
  it('corrupt file → built-ins only, no throw', () => {
    require('fs').writeFileSync(file, '{ not json')
    expect(new GraphTemplateStore(file).list().map((t) => t.id).sort()).toEqual(['full', 'quick-fix', 'review-only'])
  })
})
```

- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** (copy the atomic-JSON pattern from `worker-spec-store.ts`: `loadCustom(file)` via `toGraphTemplate` filter; `list()` = `[...defaultGraphTemplates(), ...loadCustom()]`; `save`/`delete` write only the custom array with tmp+rename; `defaultGraphTemplatePath()` = `join(ravenHome(), '.raven-nest', 'graph-templates.json')`).
- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** `feat(graph): atomic template store (built-in ⊕ custom)`

---

### Task 3: Graph runner (pure orchestration)

**Files:**
- Create: `electron/integrations/graph-runner.ts`
- Test: `electron/integrations/graph-runner.test.ts`

- [ ] **Step 1: Failing test** — ready/fan-out/gate/completion/failure

```ts
import { describe, it, expect } from 'vitest'
import { defaultGraphTemplates } from './graph-template'
import { readyNodes, gateState, advanceGraph, type GraphRun, type NodeRunState } from './graph-runner'

const full = defaultGraphTemplates().find((t) => t.id === 'full')!
const run = (states: Record<string, NodeRunState>): GraphRun => ({
  runId: 'r', ticketId: 't', templateId: 'full', worktreePath: '/w', branch: 'b', startedAt: 0,
  nodes: Object.fromEntries(full.nodes.map((n) => [n.id, { state: states[n.id] ?? 'queued' }])),
})

describe('graph-runner', () => {
  it('only the root (architect) is ready at start', () => {
    expect(readyNodes(full, run({}))).toEqual(['architect'])
  })
  it('after coder done, all 3 reviewers become ready together (fan-out)', () => {
    const r = readyNodes(full, run({ architect: 'done', coder: 'done' }))
    expect(r.sort()).toEqual(['rev-perf', 'rev-security', 'rev-types'])
  })
  it('gate waits until all reviewers done; passes when all clean', () => {
    expect(gateState(full, run({ 'rev-security': 'done', 'rev-types': 'done' }), 'gate')).toBe('waiting')
    expect(gateState(full, run({ 'rev-security': 'done', 'rev-types': 'done', 'rev-perf': 'done' }), 'gate')).toBe('passed')
  })
  it('gate blocks (human-in-the-loop) when a reviewer needs input', () => {
    expect(gateState(full, run({ 'rev-security': 'done', 'rev-types': 'done', 'rev-perf': 'needs_input' }), 'gate')).toBe('blocked')
  })
  it('advanceGraph emits node_needs_input once and reports blockedOn', () => {
    const out = advanceGraph(full, run({ architect: 'done', coder: 'done', 'rev-security': 'done', 'rev-types': 'done', 'rev-perf': 'needs_input' }))
    expect(out.blockedOn).toContain('gate')
    expect(out.events.some((e) => e.type === 'graph.gate_blocked')).toBe(true)
  })
  it('advanceGraph marks completed when tester is done', () => {
    const out = advanceGraph(full, run(Object.fromEntries(full.nodes.map((n) => [n.id, 'done'])) as Record<string, NodeRunState>))
    expect(out.completed).toBe(true)
  })
})
```

- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** `graph-runner.ts` — `NodeRunState`/`NodeRuntime`/`GraphRun` types; `readyNodes` (queued nodes whose deps are all `done`); `gateState` (waiting/blocked/passed per §6); `advanceGraph` returns `{ toStart, events, completed, blockedOn }`, emits `graph.*` events only on transitions (compare against current `run.nodes` state), marks descendants of `failed` as `skipped`. Import `DomainEvent` from `bus-types.ts` (events added in Task 5 — define the emitted event objects inline; Task 5 makes them type-safe).
- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** `feat(graph): pure graph runner (ready/gate/advance)`

---

### Task 4: Structured handoff artifacts

**Files:**
- Create: `electron/integrations/graph-handoff.ts`
- Test: `electron/integrations/graph-handoff.test.ts`

Pure path + input-composition helpers (no fs). `artifactPath(node)` → `.nest/graph/<id>.<ext>` (`.md` for architect/coder, `review-<focus>.json` for reviewers). `composeNodeInput(node, upstream: {role, focus?, artifact: string}[])` extends `composeStepInput`: prepend each upstream artifact labeled by role/focus, then the node's instructions (or a role default), then — for non-leaf nodes — the "write your artifact to <path>" instruction.

- [ ] Steps 1–5 (TDD): test that a reviewer node's input includes all 3 upstream reviewer-visible artifacts labeled by focus; that `artifactPath` is stable; commit `feat(graph): structured handoff artifacts`.

---

### Task 5: Bus events + guards + recipes

**Files:**
- Modify: `electron/integrations/bus-types.ts` (add 5 events to `DomainEvent` union + `isDomainEvent` cases)
- Modify: `electron/integrations/bus-types.test.ts` (guard tests)
- Modify: `electron/integrations/recipes.ts` (default recipes for the 3 notify-worthy events)

Events: `graph.node_started {ticketId,nodeId,role}`, `graph.node_done {ticketId,nodeId,role,summary?}`, `graph.node_needs_input {ticketId,nodeId,role,question?}`, `graph.gate_blocked {ticketId,gateId,blockedBy:string[]}`, `graph.completed {ticketId,templateId}`.

- [ ] Steps 1–5 (TDD): guard accepts well-formed / rejects missing fields; recipes map `node_needs_input`/`gate_blocked`/`completed` → `notify` (+ `logOutcome` on completed). Keep swap-not-merge semantics. Commit `feat(graph): bus events + default recipes`.

---

### Task 6: Graph view mapping (pure, for React Flow)

**Files:**
- Create: `src/lib/graph-view.ts`
- Test: `src/lib/graph-view.test.ts`
- Modify: `package.json` (add `@xyflow/react`, `@dagrejs/dagre`)

Pure: `toFlow(template, run) → { nodes: RFNode[], edges: RFEdge[] }` with dagre-computed positions (deterministic given fixed nodesep/ranksep). No React import — just data. Maps node state → a `data.state` field the custom node reads.

- [ ] Steps: install deps; TDD that `toFlow(full, run)` yields 7 nodes + correct edge count, fan-out edges from `coder`, and monotonically increasing `x` by rank; commit `feat(graph): pure template→flow mapping + deps`.

---

### Task 7+ (UI render + main wiring) — REQUIRES GERO'S VISUAL VALIDATION / LIVE SMOKE

Scaffold, do not mark done without Gero:
- `src/components/GraphBoard.tsx` — auto-packed grid of **static** mini-graph tiles (SVG/CSS, no React Flow), Minimal theme (color = state), reuses `GraphRun`. (Mockup approved: `graph-grid.html`.)
- `src/components/GraphCanvas.tsx` — React Flow drill-down using `toFlow`; custom node component; minimap/pan/zoom. (Mockup: `graph-detail.html`.)
- `src/components/GraphInspector.tsx` — selected-node panel (waiting-on / terminal preview / Open terminal · Reply · Approve).
- `src/components/GraphTemplateEditor.tsx` — form to pick + edit a template (±reviewers, model per node), save via store.
- **F6 main wiring** (`main.ts`, IPC): orchestrator tick sampling panes via `deriveAgentState`, calling `advanceGraph`, creating worktree+panes under Integrations, writing artifacts. Equivalent to the Épica B/C/D "fast-follows" — needs a live smoke on Windows. Document, don't auto-ship.

---

## Self-Review

- **Spec coverage:** §4 model→T1; §5 templates→T1/T2; §6 runner→T3; handoff §7→T4; bus §8→T5; UI §9→T6(pure)+T7(render); testing §10→per-task; phases §11→T1–T7. ✓
- **Type consistency:** `GraphNode.dependsOn`, `NodeRunState`, `GraphRun.nodes` record, `advanceGraph→{toStart,events,completed,blockedOn}`, `gateState→waiting|blocked|passed` used consistently T1↔T3↔T6. ✓
- **Placeholders:** T1–T3 carry full code; T4–T6 carry precise contracts + test intents (implementations follow the established store/guard patterns verbatim). T7+ intentionally scaffold-only (visual gate). ✓
