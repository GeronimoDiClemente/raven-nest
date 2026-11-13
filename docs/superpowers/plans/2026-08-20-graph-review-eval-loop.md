# Graph Review — Eval-Loop (capa ① motor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el eval-loop del grafo: leer los veredictos de los reviewers, bloquear el gate cuando corresponde, y en modo `auto` auto-reparar (re-inyectar al coder y re-correr) hasta converger o escalar a humano.

**Architecture:** Todo el trabajo de este plan es **capa ① (motor, `feat/integrations`)** — puro y testeable, sin depender del branch del editor. Extiende los módulos existentes `graph-verdict.ts` (nuevo), `graph-review.ts` (nuevo), `graph-orchestrator.ts` (`planTick`), `graph-runner.ts` (tipos), `graph-handoff.ts` (`composeNodeInput`), `graph-run-store.ts` (persistencia) y el tick + IPC de `main.ts` (effect layer). La capa ② (card C) y ③ (puente al editor) son **planes aparte**, bloqueados hasta que se mergee `feat/code-editor-integration`.

**Tech Stack:** TypeScript, Electron main process, Vitest. Núcleo puro sin fs/PTY (los ports se inyectan), mismo patrón que `agent-status.ts` / `automation-runner.ts`.

**Spec:** `docs/superpowers/specs/2026-08-20-graph-review-in-editor-design.md`

---

## Scope

**En este plan (capa ①):** verdict parsing, eval-loop en `planTick`, transforms de decisión (`resetBranchForRerun`, `applyDecision`), auto-repair + escalación, `mode` (auto/gate/step), exit-code→`failed`, persistencia de campos nuevos, wiring + IPC en `main.ts`.

**Fuera (planes futuros, esperan editor merge):** `GraphReviewCard.tsx` (capa ②), puente `Open diff in editor` (capa ③), file/line anchors en concerns.

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `electron/integrations/graph-verdict.ts` | Parsear `review-*.json` → `Verdict` | **Crear** |
| `electron/integrations/graph-review.ts` | Transforms puros de decisión: re-run + apply decision | **Crear** |
| `electron/integrations/graph-runner.ts` | Tipos `GraphMode`, `PendingDecision`; campos nuevos en `NodeRuntime`/`GraphRun` | Modificar |
| `electron/integrations/graph-orchestrator.ts` | `planTick`: verdict pass, exit-code, pendingDecision, mode gating, auto-repair | Modificar |
| `electron/integrations/graph-handoff.ts` | `composeNodeInput` acepta `revisionNote` | Modificar |
| `electron/integrations/graph-run-store.ts` | Validar/preservar campos nuevos en round-trip | Modificar |
| `electron/integrations/graph-config.ts` | Default `mode` + `maxReviewRounds` por repo (store JSON) | **Crear** |
| `electron/main.ts` | Tick: pasar ports; IPC: setMode/approve/requestChanges/list/get; kill PTYs en re-run | Modificar |

**Comando de test:** single-file `npx vitest run electron/__tests__/<file>.test.ts` · suite completa `npm test`.

---

### Task 1: `graph-verdict.ts` — parse verdict

**Files:**
- Create: `electron/integrations/graph-verdict.ts`
- Test: `electron/__tests__/graph-verdict.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { parseVerdict } from '../integrations/graph-verdict'

describe('parseVerdict', () => {
  it('parses a valid blocking verdict', () => {
    const raw = JSON.stringify({ concerns: ['idempotency key reused'], blocking: true })
    expect(parseVerdict(raw)).toEqual({ concerns: ['idempotency key reused'], blocking: true })
  })
  it('parses a clean non-blocking verdict', () => {
    expect(parseVerdict(JSON.stringify({ concerns: [], blocking: false }))).toEqual({ concerns: [], blocking: false })
  })
  it('coerces missing concerns to [] and keeps blocking', () => {
    expect(parseVerdict(JSON.stringify({ blocking: true }))).toEqual({ concerns: [], blocking: true })
  })
  it('returns null for null input (artifact missing)', () => {
    expect(parseVerdict(null)).toBeNull()
  })
  it('returns null for malformed JSON', () => {
    expect(parseVerdict('{not json')).toBeNull()
  })
  it('returns null when blocking is not a boolean', () => {
    expect(parseVerdict(JSON.stringify({ concerns: [], blocking: 'yes' }))).toBeNull()
  })
  it('drops non-string concerns', () => {
    expect(parseVerdict(JSON.stringify({ concerns: ['a', 3, null, 'b'], blocking: false })))
      .toEqual({ concerns: ['a', 'b'], blocking: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/graph-verdict.test.ts`
Expected: FAIL — cannot find module `../integrations/graph-verdict`.

- [ ] **Step 3: Write minimal implementation**

```ts
// Parse a reviewer's handoff verdict (.nest/graph/review-<focus>.json). The
// reviewer is prompted (graph-handoff.roleDefault) to emit {concerns, blocking}.
// Pure: string|null → Verdict|null. A missing artifact (null) or any shape that
// isn't a real verdict returns null so the caller applies its own policy
// (graph-orchestrator treats null as blocking — never "no verdict = no objection").
export interface Verdict {
  concerns: string[]
  blocking: boolean
}

export function parseVerdict(raw: string | null): Verdict | null {
  if (raw === null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const r = data as Record<string, unknown>
  if (typeof r.blocking !== 'boolean') return null
  const concerns = Array.isArray(r.concerns) ? r.concerns.filter((c): c is string => typeof c === 'string') : []
  return { concerns, blocking: r.blocking }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/graph-verdict.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/graph-verdict.ts electron/__tests__/graph-verdict.test.ts
git commit -m "feat(graph): parseVerdict — read reviewer {concerns,blocking} artifact"
```

---

### Task 2: Type extensions + persistence round-trip

**Files:**
- Modify: `electron/integrations/graph-runner.ts` (add types + fields)
- Modify: `electron/integrations/graph-run-store.ts` (`toNodeRuntime`, `toGraphRun`)
- Test: `electron/__tests__/graph-run-store.test.ts` (extend existing)

- [ ] **Step 1: Add types and fields in `graph-runner.ts`**

At the top imports add: `import type { Verdict } from './graph-verdict'`

Add after `NodeRunState`:

```ts
export type GraphMode = 'auto' | 'gate' | 'step'

export type PendingDecision =
  | { kind: 'approve'; gateId: string }
  | { kind: 'requestChanges'; feedback: string }
```

Extend `NodeRuntime` with two optional fields:

```ts
  verdict?: Verdict    // a reviewer node's parsed {concerns, blocking}
  exitCode?: number    // last pane exit code (≠0 → the node 'failed')
```

Extend `GraphRun` with:

```ts
  mode: GraphMode                          // auto (default) | gate | step
  round: number                            // current review round (retry cap)
  revisionNotes?: Record<string, string>   // nodeId → feedback to prepend on re-run
  pendingDecision?: PendingDecision         // human action queued for the tick to apply
```

- [ ] **Step 2: Write the failing persistence test**

Add to `electron/__tests__/graph-run-store.test.ts`:

```ts
it('round-trips mode, round, revisionNotes, pendingDecision and node verdict/exitCode', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'graphrun-')))
  const file = join(dir, 'graph-runs.json')
  const store = new GraphRunStore(file)
  const run: GraphRun = {
    runId: 'r1', ticketId: 't1', templateId: 'full', worktreePath: dir, branch: 'b',
    startedAt: 1, mode: 'gate', round: 2,
    revisionNotes: { coder: 'fix the key' },
    pendingDecision: { kind: 'requestChanges', feedback: 'scope per attempt' },
    nodes: {
      rev: { state: 'blocked', verdict: { concerns: ['x'], blocking: true } },
      coder: { state: 'failed', exitCode: 2 },
    },
  }
  store.save(run, [])
  const loaded = store.get('r1')!.run
  expect(loaded.mode).toBe('gate')
  expect(loaded.round).toBe(2)
  expect(loaded.revisionNotes).toEqual({ coder: 'fix the key' })
  expect(loaded.pendingDecision).toEqual({ kind: 'requestChanges', feedback: 'scope per attempt' })
  expect(loaded.nodes.rev.verdict).toEqual({ concerns: ['x'], blocking: true })
  expect(loaded.nodes.coder.exitCode).toBe(2)
})
```

(Reuse the file's existing imports: `realpathSync`, `mkdtempSync`, `tmpdir`, `join`, `GraphRun`, `GraphRunStore`. Add any that are missing.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/graph-run-store.test.ts`
Expected: FAIL — loaded `mode`/`round`/`verdict`/`exitCode` are `undefined` (validators drop unknown fields).

- [ ] **Step 4: Update the validators in `graph-run-store.ts`**

In `toNodeRuntime`, after the `artifact` line, before `return out`:

```ts
  if (r.verdict && typeof r.verdict === 'object') {
    const v = r.verdict as Record<string, unknown>
    if (typeof v.blocking === 'boolean') {
      out.verdict = {
        blocking: v.blocking,
        concerns: Array.isArray(v.concerns) ? v.concerns.filter((c): c is string => typeof c === 'string') : [],
      }
    }
  }
  if (typeof r.exitCode === 'number') out.exitCode = r.exitCode
```

In `toGraphRun`, change the returned object to carry the new fields (default `mode`/`round` for runs persisted before this change):

```ts
  const mode = r.mode === 'gate' || r.mode === 'step' ? r.mode : 'auto'
  const out: GraphRun = {
    runId: r.runId, ticketId: r.ticketId, templateId: r.templateId,
    worktreePath: r.worktreePath, branch: r.branch, startedAt: r.startedAt,
    nodes, mode, round: typeof r.round === 'number' ? r.round : 0,
  }
  if (r.revisionNotes && typeof r.revisionNotes === 'object') {
    const rn: Record<string, string> = {}
    for (const [k, v] of Object.entries(r.revisionNotes as Record<string, unknown>)) if (typeof v === 'string') rn[k] = v
    out.revisionNotes = rn
  }
  const pd = r.pendingDecision as Record<string, unknown> | undefined
  if (pd && (pd.kind === 'approve' && typeof pd.gateId === 'string')) out.pendingDecision = { kind: 'approve', gateId: pd.gateId }
  else if (pd && (pd.kind === 'requestChanges' && typeof pd.feedback === 'string')) out.pendingDecision = { kind: 'requestChanges', feedback: pd.feedback }
  return out
```

(`GraphRun` now requires `mode`/`round`, so `toGraphRun` must build them; the `import type` list already has `GraphRun`.)

- [ ] **Step 5: Run test to verify it passes; then the full store suite**

Run: `npx vitest run electron/__tests__/graph-run-store.test.ts`
Expected: PASS (existing + new). Fix any existing test that constructs a `GraphRun` literal without `mode`/`round` by adding `mode: 'auto', round: 0`.

- [ ] **Step 6: Commit**

```bash
git add electron/integrations/graph-runner.ts electron/integrations/graph-run-store.ts electron/__tests__/graph-run-store.test.ts
git commit -m "feat(graph): persist mode/round/revisionNotes/pendingDecision + node verdict/exitCode"
```

---

### Task 3: Eval-loop — read verdicts in `planTick`

The reviewer node transitions to `done` from its sample; `planTick` must read its verdict artifact and override to `blocked` when blocking (or when the verdict is missing).

**Files:**
- Modify: `electron/integrations/graph-orchestrator.ts` (`planTick`)
- Test: `electron/__tests__/graph-orchestrator.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
it('a reviewer that finished with a blocking verdict becomes blocked, not done', () => {
  const t = /* template: coder(done) → rev(reviewer) */ makeReviewTemplate()
  const run = makeRun(t, { coder: { state: 'done' }, rev: { state: 'running', paneId: 'p:rev' } })
  const plan = planTick(t, run, { rev: 'done' }, {
    now: 100, maxReviewRounds: 2,
    readArtifact: (_wt, rel) => rel.endsWith('review-rev.json')
      ? JSON.stringify({ concerns: ['double-charge'], blocking: true }) : null,
  })
  expect(plan.run.nodes.rev.state).toBe('blocked')
  expect(plan.run.nodes.rev.verdict).toEqual({ concerns: ['double-charge'], blocking: true })
})

it('a reviewer with a clean verdict stays done and carries concerns', () => {
  const t = makeReviewTemplate()
  const run = makeRun(t, { coder: { state: 'done' }, rev: { state: 'running', paneId: 'p:rev' } })
  const plan = planTick(t, run, { rev: 'done' }, {
    now: 100, maxReviewRounds: 2,
    readArtifact: () => JSON.stringify({ concerns: ['nit: rename'], blocking: false }),
  })
  expect(plan.run.nodes.rev.state).toBe('done')
  expect(plan.run.nodes.rev.verdict!.blocking).toBe(false)
})

it('a reviewer that finished with NO verdict is treated as blocked (conservative)', () => {
  const t = makeReviewTemplate()
  const run = makeRun(t, { coder: { state: 'done' }, rev: { state: 'running', paneId: 'p:rev' } })
  const plan = planTick(t, run, { rev: 'done' }, {
    now: 100, maxReviewRounds: 2, readArtifact: () => null,
  })
  expect(plan.run.nodes.rev.state).toBe('blocked')
  expect(plan.run.nodes.rev.verdict).toEqual({ concerns: ['reviewer produced no parseable verdict'], blocking: true })
})
```

Add helpers `makeReviewTemplate()` / `makeRun()` at the top of the test file if not present (a 2-node template `coder → rev` where `rev.role==='reviewer'`, and a `GraphRun` builder that fills `mode:'auto', round:0`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/graph-orchestrator.test.ts`
Expected: FAIL — `rev` is `done` (verdict never read) and `maxReviewRounds` isn't a valid port.

- [ ] **Step 3: Extend `OrchestratorPorts` and the verdict pass in `planTick`**

In `graph-orchestrator.ts` add imports: `import { parseVerdict, type Verdict } from './graph-verdict'`.

Extend `OrchestratorPorts`:

```ts
  maxReviewRounds: number                       // auto-repair retry cap
  exitCode?: (paneId: string) => number | null | undefined  // last pane exit code
```

In `planTick`, right after `const synced = syncNodeStates(run, samples, ports.now)`, before building `doneEvents`, insert the **verdict pass** — it mutates a fresh copy so purity holds:

```ts
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
```

Then replace the remaining uses of `synced` in `planTick` with `synced2` (the `doneEvents` loop, `advanceGraph(t, synced2)`, `{ ...synced2.nodes }`, and the returned `{ ...synced2, nodes }`).

Note: `byId` is already built at the top of `planTick`; `artifactPath` and `NodeRuntime` are already imported.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/graph-orchestrator.test.ts`
Expected: PASS (existing + 3 new). Existing tests that call `planTick` must pass `maxReviewRounds` in ports — add `maxReviewRounds: 2` to their ports object.

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/graph-orchestrator.ts electron/__tests__/graph-orchestrator.test.ts
git commit -m "feat(graph): eval-loop — read reviewer verdict, block gate on blocking concern"
```

---

### Task 4: `graph-review.ts` — `resetBranchForRerun` + revisionNote in prompt

**Files:**
- Create: `electron/integrations/graph-review.ts`
- Modify: `electron/integrations/graph-handoff.ts` (`composeNodeInput` gains `revisionNote`)
- Test: `electron/__tests__/graph-review.test.ts`, extend `electron/__tests__/graph-handoff.test.ts`

- [ ] **Step 1: Write the failing test for `resetBranchForRerun`**

```ts
import { describe, it, expect } from 'vitest'
import { resetBranchForRerun } from '../integrations/graph-review'
import type { GraphTemplate } from '../integrations/graph-template'
import type { GraphRun } from '../integrations/graph-runner'

const T: GraphTemplate = {
  id: 'full', name: 'full', nodes: [
    { id: 'architect', role: 'architect', kind: 'agent', dependsOn: [] },
    { id: 'coder', role: 'coder', kind: 'agent', dependsOn: ['architect'] },
    { id: 'rev', role: 'reviewer', kind: 'agent', dependsOn: ['coder'] },
    { id: 'gate', role: 'gate', kind: 'gate', dependsOn: ['rev'] },
  ], createdAt: 0, updatedAt: 0,
}
const run = (): GraphRun => ({
  runId: 'r', ticketId: 't', templateId: 'full', worktreePath: '/w', branch: 'b',
  startedAt: 0, mode: 'auto', round: 0, nodes: {
    architect: { state: 'done' }, coder: { state: 'done', paneId: 'p:coder', endedAt: 5 },
    rev: { state: 'blocked', paneId: 'p:rev', verdict: { concerns: ['x'], blocking: true } },
    gate: { state: 'queued' },
  },
})

describe('resetBranchForRerun', () => {
  it('resets coder + descendants to queued, keeps architect done', () => {
    const next = resetBranchForRerun(T, run(), 'scope key per attempt')
    expect(next.nodes.architect.state).toBe('done')
    expect(next.nodes.coder.state).toBe('queued')
    expect(next.nodes.rev.state).toBe('queued')
    expect(next.nodes.gate.state).toBe('queued')
  })
  it('clears paneId/endedAt/verdict on the reset nodes', () => {
    const next = resetBranchForRerun(T, run(), 'fix')
    expect(next.nodes.coder.paneId).toBeUndefined()
    expect(next.nodes.coder.endedAt).toBeUndefined()
    expect(next.nodes.rev.verdict).toBeUndefined()
  })
  it('stores the feedback as revisionNote on the coder and bumps round', () => {
    const next = resetBranchForRerun(T, run(), 'scope key per attempt')
    expect(next.revisionNotes!.coder).toBe('scope key per attempt')
    expect(next.round).toBe(1)
  })
  it('does not mutate the input run', () => {
    const r = run(); resetBranchForRerun(T, r, 'f')
    expect(r.nodes.coder.state).toBe('done')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/__tests__/graph-review.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `graph-review.ts` (`resetBranchForRerun`)**

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run electron/__tests__/graph-review.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add `revisionNote` to `composeNodeInput` (failing test first)**

Add to `electron/__tests__/graph-handoff.test.ts`:

```ts
it('prepends a revision note when re-running a node', () => {
  const node = { id: 'coder', role: 'coder', kind: 'agent', dependsOn: [] } as const
  const out = composeNodeInput(node, [], false, 'scope the key per attempt')
  expect(out).toContain('Revision requested: scope the key per attempt')
})
```

- [ ] **Step 6: Implement — extend `composeNodeInput` signature in `graph-handoff.ts`**

Change the signature and prepend the note first:

```ts
export function composeNodeInput(node: GraphNode, upstream: UpstreamArtifact[], isLeaf: boolean, revisionNote?: string): string {
  const parts: string[] = []
  if (revisionNote) parts.push(`Revision requested: ${revisionNote}`)
  for (const u of upstream) parts.push(`Handoff from ${label(u)}:\n\n${u.content}`)
  // ...unchanged...
```

- [ ] **Step 7: Run both test files**

Run: `npx vitest run electron/__tests__/graph-review.test.ts electron/__tests__/graph-handoff.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add electron/integrations/graph-review.ts electron/integrations/graph-handoff.ts electron/__tests__/graph-review.test.ts electron/__tests__/graph-handoff.test.ts
git commit -m "feat(graph): resetBranchForRerun + revisionNote in composeNodeInput"
```

---

### Task 5: `graph-review.ts` — `applyDecision` (approve / requestChanges)

**Files:**
- Modify: `electron/integrations/graph-review.ts`
- Test: `electron/__tests__/graph-review.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
import { applyDecision } from '../integrations/graph-review'

describe('applyDecision', () => {
  it('approve: overrides blocked reviewers + gate to done and clears the decision', () => {
    const r = run(); r.pendingDecision = { kind: 'approve', gateId: 'gate' }
    const next = applyDecision(T, r)
    expect(next.nodes.rev.state).toBe('done')
    expect(next.nodes.gate.state).toBe('done')
    expect(next.pendingDecision).toBeUndefined()
  })
  it('requestChanges: re-runs the coder branch with the feedback and clears the decision', () => {
    const r = run(); r.pendingDecision = { kind: 'requestChanges', feedback: 'per-attempt key' }
    const next = applyDecision(T, r)
    expect(next.nodes.coder.state).toBe('queued')
    expect(next.revisionNotes!.coder).toBe('per-attempt key')
    expect(next.round).toBe(1)
    expect(next.pendingDecision).toBeUndefined()
  })
  it('no-op when there is no pending decision', () => {
    const r = run()
    expect(applyDecision(T, r)).toEqual(r)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/__tests__/graph-review.test.ts`
Expected: FAIL — `applyDecision` not exported.

- [ ] **Step 3: Implement `applyDecision` in `graph-review.ts`**

```ts
/** Apply a human's queued decision. approve → mark the gate's blocked upstream
 *  reviewers and the gate 'done' so downstream unblocks. requestChanges →
 *  resetBranchForRerun with the feedback. Always clears pendingDecision. Pure. */
export function applyDecision(t: GraphTemplate, run: GraphRun): GraphRun {
  const d = run.pendingDecision
  if (!d) return run
  if (d.kind === 'requestChanges') {
    const next = resetBranchForRerun(t, run, d.feedback)
    delete next.pendingDecision
    return next
  }
  // approve: force the gate's dependencies (and the gate) to done
  const gate = t.nodes.find((n) => n.id === d.gateId)
  const force = new Set<string>([d.gateId, ...(gate?.dependsOn ?? [])])
  const nodes: Record<string, NodeRuntime> = {}
  for (const [id, rt] of Object.entries(run.nodes)) {
    nodes[id] = force.has(id) && rt.state !== 'done' ? { ...rt, state: 'done' } : rt
  }
  const next = { ...run, nodes }
  delete next.pendingDecision
  return next
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run electron/__tests__/graph-review.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/graph-review.ts electron/__tests__/graph-review.test.ts
git commit -m "feat(graph): applyDecision — approve overrides gate / requestChanges re-runs"
```

---

### Task 6: `planTick` — apply pendingDecision + mode gating

**Files:**
- Modify: `electron/integrations/graph-orchestrator.ts`
- Test: `electron/__tests__/graph-orchestrator.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

```ts
it('applies a pending approve before advancing (gate resolves next)', () => {
  const t = makeReviewTemplate() // coder → rev → gate
  const run = makeRun(t, {
    coder: { state: 'done' }, rev: { state: 'blocked', verdict: { concerns: ['x'], blocking: true } },
    gate: { state: 'queued' },
  })
  run.pendingDecision = { kind: 'approve', gateId: 'gate' }
  const plan = planTick(t, run, {}, { now: 1, maxReviewRounds: 2, readArtifact: () => null })
  expect(plan.run.nodes.rev.state).toBe('done')
  expect(plan.run.pendingDecision).toBeUndefined()
})

it('mode "gate": a clean passed gate is NOT auto-resolved, it waits', () => {
  const t = makeReviewTemplate()
  const run = makeRun(t, { coder: { state: 'done' }, rev: { state: 'done' }, gate: { state: 'queued' } })
  run.mode = 'gate'
  const plan = planTick(t, run, {}, { now: 1, maxReviewRounds: 2, readArtifact: () => null })
  expect(plan.run.nodes.gate.state).toBe('queued')       // held, not done
  expect(plan.blockedOn).toContain('gate')
})

it('mode "auto": a clean passed gate auto-resolves to done', () => {
  const t = makeReviewTemplate()
  const run = makeRun(t, { coder: { state: 'done' }, rev: { state: 'done' }, gate: { state: 'queued' } })
  run.mode = 'auto'
  const plan = planTick(t, run, {}, { now: 1, maxReviewRounds: 2, readArtifact: () => null })
  expect(plan.run.nodes.gate.state).toBe('done')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/__tests__/graph-orchestrator.test.ts`
Expected: FAIL — pendingDecision ignored; gate auto-resolves regardless of mode.

- [ ] **Step 3: Wire into `planTick`**

Add import: `import { applyDecision } from './graph-review'`.

After the verdict pass builds `synced2`, apply any pending decision **before** `advanceGraph`:

```ts
  const decided = synced2.pendingDecision ? applyDecision(t, synced2) : synced2
  const adv = advanceGraph(t, decided)
  const nodes: Record<string, NodeRuntime> = { ...decided.nodes }
```

(Replace subsequent `synced2` references with `decided`, and the returned run spreads `decided`.)

Mode gating — in the `for (const id of adv.toStart)` loop, when the node is a gate, only auto-resolve in `auto` mode; otherwise hold it and surface it:

```ts
    if (node.kind === 'gate') {
      if (decided.mode === 'auto') {
        nodes[id] = { ...nodes[id], state: 'done', endedAt: ports.now }
      } else {
        blockedOn.push(id) // held for human approval (gate/step mode)
      }
      continue
    }
```

`blockedOn` is currently `adv.blockedOn`; collect the held gates into a local array and merge into the returned `blockedOn`. Change the return to `blockedOn: [...adv.blockedOn, ...heldGates]` (declare `const heldGates: string[] = []` and push there instead of the shared `blockedOn`).

Also wire the revisionNote into the launched prompt: in the same `toStart` loop, where the agent node's input is composed, pass the coder's revision note as the 4th arg:

```ts
    const input = composeNodeInput(node, upstreamArtifacts(t, node, ports, run.worktreePath), isLeaf(t, id), decided.revisionNotes?.[id])
```

- [ ] **Step 3b: Add a test that the re-run's feedback reaches the relaunched coder**

```ts
it('relaunched coder gets its revisionNote in the composed input', () => {
  const t = makeReviewTemplate() // coder → rev → gate
  const run = makeRun(t, { coder: { state: 'queued' } })
  run.revisionNotes = { coder: 'scope key per attempt' }
  const plan = planTick(t, run, {}, { now: 1, maxReviewRounds: 2, readArtifact: () => null })
  const coderStart = plan.start.find(s => s.nodeId === 'coder')!
  expect(coderStart.input).toContain('Revision requested: scope key per attempt')
})
```

(`makeReviewTemplate`'s coder must have `dependsOn: []` or an already-`done` upstream so it's ready to launch.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run electron/__tests__/graph-orchestrator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/graph-orchestrator.ts electron/__tests__/graph-orchestrator.test.ts
git commit -m "feat(graph): planTick applies pendingDecision + gates hold in gate/step mode"
```

---

### Task 7: `planTick` — auto-repair + escalation

**Files:**
- Modify: `electron/integrations/graph-orchestrator.ts`
- Modify: `electron/integrations/bus-types.ts` (add `graph.escalated` event)
- Test: `electron/__tests__/graph-orchestrator.test.ts` (extend)

- [ ] **Step 1: Add the `graph.escalated` DomainEvent**

In `electron/integrations/bus-types.ts` add to the `DomainEvent` union (match the existing `graph.gate_blocked` shape):

```ts
  | { type: 'graph.escalated'; ticketId: string; gateId: string; round: number }
```

- [ ] **Step 2: Write the failing tests**

```ts
it('mode "auto": a blocked gate under the retry cap re-runs the coder (no gate_blocked)', () => {
  const t = makeReviewTemplate()
  const run = makeRun(t, {
    coder: { state: 'done' }, rev: { state: 'blocked', verdict: { concerns: ['x'], blocking: true } },
    gate: { state: 'queued' },
  })
  run.mode = 'auto'; run.round = 0
  const plan = planTick(t, run, {}, { now: 1, maxReviewRounds: 2, readArtifact: () => null })
  expect(plan.run.nodes.coder.state).toBe('queued')   // re-run triggered
  expect(plan.run.round).toBe(1)
  expect(plan.events.some(e => e.type === 'graph.gate_blocked')).toBe(false)
})

it('mode "auto": at the retry cap it escalates instead of re-running', () => {
  const t = makeReviewTemplate()
  const run = makeRun(t, {
    coder: { state: 'done' }, rev: { state: 'blocked', verdict: { concerns: ['x'], blocking: true } },
    gate: { state: 'queued' },
  })
  run.mode = 'auto'; run.round = 2
  const plan = planTick(t, run, {}, { now: 1, maxReviewRounds: 2, readArtifact: () => null })
  expect(plan.run.nodes.coder.state).toBe('done')     // not re-run
  expect(plan.events.some(e => e.type === 'graph.escalated')).toBe(true)
  expect(plan.blockedOn).toContain('gate')
})
```

- [ ] **Step 3: Implement in `planTick`**

After computing `adv = advanceGraph(t, decided)` and before materializing start actions, insert the auto-repair branch. A blocked gate is any `g` in `adv.blockedOn` that is a gate with `gateState==='blocked'` (import `gateState` from `./graph-runner`):

```ts
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
```

Add `import { advanceGraph, gateState } from './graph-runner'` (extend the existing import) and `import { resetBranchForRerun } from './graph-review'` (extend Task 6's import). The early `return` on re-run skips launching anything this tick — the next tick relaunches the coder.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run electron/__tests__/graph-orchestrator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/graph-orchestrator.ts electron/integrations/bus-types.ts electron/__tests__/graph-orchestrator.test.ts
git commit -m "feat(graph): auto-repair loop — re-run coder on block, escalate at retry cap"
```

---

### Task 8: `planTick` — exit-code → `failed`

**Files:**
- Modify: `electron/integrations/graph-orchestrator.ts`
- Test: `electron/__tests__/graph-orchestrator.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
it('a node whose pane exited non-zero becomes failed (not done)', () => {
  const t = makeReviewTemplate() // coder → rev → gate
  const run = makeRun(t, { coder: { state: 'running', paneId: 'p:coder' } })
  const plan = planTick(t, run, { coder: 'done' }, {
    now: 1, maxReviewRounds: 2, readArtifact: () => null,
    exitCode: (paneId) => (paneId === 'p:coder' ? 2 : null),
  })
  expect(plan.run.nodes.coder.state).toBe('failed')
  expect(plan.run.nodes.coder.exitCode).toBe(2)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/__tests__/graph-orchestrator.test.ts`
Expected: FAIL — coder resolves to `done`.

- [ ] **Step 3: Implement — exit-code pass in `planTick`**

Right after the verdict pass (still building on `withVerdicts`, before `synced2`), add:

```ts
  // Exit-code pass: a node whose pane just finished but exited non-zero is
  // 'failed', not 'done' (descendantsOfFailed in advanceGraph then cuts its
  // branch). Only applies to nodes that transitioned to done this tick.
  if (ports.exitCode) {
    for (const [id, rt] of Object.entries(withVerdicts)) {
      const justDone = rt.state === 'done' && run.nodes[id]?.state !== 'done'
      if (!justDone || !rt.paneId) continue
      const code = ports.exitCode(rt.paneId)
      if (typeof code === 'number' && code !== 0) withVerdicts[id] = { ...rt, state: 'failed', exitCode: code }
    }
  }
```

(This runs before `const synced2 = { ...synced, nodes: withVerdicts }`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run electron/__tests__/graph-orchestrator.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all green. Fix any GraphRun literal in other tests missing `mode`/`round`.

- [ ] **Step 6: Commit**

```bash
git add electron/integrations/graph-orchestrator.ts electron/__tests__/graph-orchestrator.test.ts
git commit -m "feat(graph): exit-code pass — non-zero pane exit marks node failed"
```

---

### Task 9: `graph-config` store + `main.ts` wiring & IPC (effect layer)

> Effect layer — needs a LIVE smoke, same caveat as F6 (spec §9). Unit-test the pure `graph-config` store; the IPC/tick glue is verified by the smoke.

**Files:**
- Create: `electron/integrations/graph-config.ts`
- Test: `electron/__tests__/graph-config.test.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Write the failing test for `graph-config.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { GraphConfigStore } from '../integrations/graph-config'

describe('GraphConfigStore', () => {
  it('returns defaults for an unknown repo', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gc-')), 'graph-config.json')
    const s = new GraphConfigStore(file)
    expect(s.get('/repo/a')).toEqual({ defaultMode: 'auto', maxReviewRounds: 2 })
  })
  it('persists and reloads a per-repo config', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gc-')), 'graph-config.json')
    new GraphConfigStore(file).set('/repo/a', { defaultMode: 'gate', maxReviewRounds: 3 })
    expect(new GraphConfigStore(file).get('/repo/a')).toEqual({ defaultMode: 'gate', maxReviewRounds: 3 })
  })
})
```

- [ ] **Step 2: Implement `graph-config.ts`**

```ts
// Per-repo defaults for graph runs: the review mode a new run inherits and the
// auto-repair retry cap. Same validated/atomic JSON pattern as worker-spec-store.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import { ravenHome } from '../raven-home'
import type { GraphMode } from './graph-runner'

export interface GraphConfig { defaultMode: GraphMode; maxReviewRounds: number }
const DEFAULT: GraphConfig = { defaultMode: 'auto', maxReviewRounds: 2 }

export function defaultGraphConfigPath(): string {
  return join(ravenHome(), '.raven-nest', 'graph-config.json')
}

export class GraphConfigStore {
  constructor(private filePath: string = defaultGraphConfigPath()) {}
  private load(): Record<string, GraphConfig> {
    try { return (JSON.parse(readFileSync(this.filePath, 'utf8')) as { repos?: Record<string, GraphConfig> }).repos ?? {} }
    catch { return {} }
  }
  get(repoPath: string): GraphConfig {
    const c = this.load()[repoPath]
    if (!c) return { ...DEFAULT }
    return {
      defaultMode: c.defaultMode === 'gate' || c.defaultMode === 'step' ? c.defaultMode : 'auto',
      maxReviewRounds: typeof c.maxReviewRounds === 'number' && c.maxReviewRounds >= 0 ? c.maxReviewRounds : 2,
    }
  }
  set(repoPath: string, cfg: GraphConfig): void {
    const repos = this.load(); repos[repoPath] = cfg
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.${randomBytes(6).toString('hex')}.tmp`
      writeFileSync(tmp, JSON.stringify({ version: 1, repos }, null, 2))
      renameSync(tmp, this.filePath)
    } catch (err) { console.warn('[graph-config] write failed', err) }
  }
}
```

- [ ] **Step 3: Run the config test**

Run: `npx vitest run electron/__tests__/graph-config.test.ts`
Expected: PASS.

- [ ] **Step 4: Wire `main.ts` — construct runs with mode/round; pass ports; new IPC**

In `main.ts`:

1. Import `GraphConfigStore` and instantiate `const graphConfigStore = new GraphConfigStore()` near `const graphRunStore = ...`.
2. Track pane exit codes: where `ptyManager` is created / where pane exit is handled, keep `const paneExitCode = new Map<string, number>()` and record the code on exit for graph panes.
3. In the `graph:run:start` handler (~line 2960), read the repo config and set the new fields on the constructed run:
   ```ts
   const cfg = graphConfigStore.get(input.repoPath)
   const run: GraphRun = { /* existing fields */, mode: cfg.defaultMode, round: 0 }
   ```
4. In `graphOrchestratorTick` (~line 2921), pass the new ports to `planTick`:
   ```ts
   const cfg = graphConfigStore.get(/* repoPath for this run */)
   const plan = planTick(template, run, samples, {
     now, readArtifact: readGraphArtifact,
     maxReviewRounds: cfg.maxReviewRounds,
     exitCode: (paneId) => paneExitCode.get(paneId) ?? null,
   })
   ```
   (The run doesn't currently store repoPath; use `run.worktreePath`'s repo or persist `repoPath` on the run — add `repoPath` to `graph:run:start`'s run object and to the store validator if needed. Simplest: default `maxReviewRounds: 2` if repo lookup is unavailable.)
5. After a re-run resets nodes (round bumped), the effect layer must **kill the old panes** of reset nodes: diff `run.nodes` vs `plan.run.nodes` for nodes that went back to `queued` with a prior `paneId`, and call `ptyManager.kill(paneId)` best-effort (warn-no-throw).
6. Add IPC handlers near `graph:node:attach`:
   ```ts
   ipcMain.handle('graph:run:list', () => graphRunStore.list().map((p) => p.run))
   ipcMain.handle('graph:run:get', (_e, runId: string) => graphRunStore.get(runId)?.run ?? null)
   ipcMain.handle('graph:run:setMode', (_e, runId: string, mode: GraphMode) => {
     const p = graphRunStore.get(runId); if (!p) return { ok: false as const }
     graphRunStore.save({ ...p.run, mode }, p.seen); return { ok: true as const }
   })
   ipcMain.handle('graph:gate:approve', (_e, runId: string, gateId: string) => {
     const p = graphRunStore.get(runId); if (!p) return { ok: false as const }
     graphRunStore.save({ ...p.run, pendingDecision: { kind: 'approve', gateId } }, p.seen); return { ok: true as const }
   })
   ipcMain.handle('graph:gate:requestChanges', (_e, runId: string, feedback: string) => {
     const p = graphRunStore.get(runId); if (!p) return { ok: false as const }
     graphRunStore.save({ ...p.run, pendingDecision: { kind: 'requestChanges', feedback } }, p.seen); return { ok: true as const }
   })
   ```
   (Human actions only set `pendingDecision`; the tick applies it — single-writer.)

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck` (or `npx tsc --noEmit`) then `npm test`
Expected: no type errors, all tests green.

- [ ] **Step 6: Commit**

```bash
git add electron/integrations/graph-config.ts electron/__tests__/graph-config.test.ts electron/main.ts
git commit -m "feat(graph): graph-config store + main tick/IPC wiring for eval-loop & decisions"
```

---

## Self-Review

- **Spec coverage:** §4 eval-loop → Tasks 1,3. §4 auto-repair/escalation → Task 7. §6 re-run/approve → Tasks 4,5. §7 mode → Tasks 6,9. §8 single-writer → Tasks 5,6,9; exit-code→failed → Task 8; persistence → Task 2. §5 card + §3 editor bridge → **out of scope (capa ②/③, future plans)**, noted in Scope.
- **Type consistency:** `Verdict` (Task 1) used in Tasks 2,3. `GraphMode`/`PendingDecision` (Task 2) used in 5,6,7,9. `resetBranchForRerun`/`applyDecision` (Tasks 4,5) reused in 6,7. `maxReviewRounds`/`exitCode` ports (Tasks 3,7,8) supplied in Task 9. `composeNodeInput`'s 4th arg (Task 4) is read from `run.revisionNotes` and passed in `planTick`'s `toStart` loop as `decided.revisionNotes?.[id]` (Task 6 Step 3 + test 3b).
- **Placeholder scan:** none — every code step has full code. Task 9 (effect layer) intentionally carries pointers + the live-smoke caveat (matches the F6 precedent).
