# Memory Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir lo que ocurre en un run del graph (verdicts, escalaciones, decisiones humanas, tests, CI) en observaciones persistentes de Nest Memory, sin depender de que un modelo llame a `memory_save`.

**Architecture:** Un módulo puro (`memory-bridge.ts`) que traduce `DomainEvent` + `GraphRun` a `MemorySaveInput[]`, detrás de un puerto inyectado (`MemorySink`) con implementación no-op por default. `main.ts` es el único lugar con efectos: hace fan-out del `setOnEmit` existente, engancha los dos handlers IPC de decisión humana, e inyecta el sink real cuando la rama de memoria esté mergeada.

**Tech Stack:** TypeScript, Electron main, vitest. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-08-26-memory-bridge-design.md`

## Global Constraints

- **Cero modificaciones** a `electron/memory-*.ts`, a `supabase/migrations/20260730000000_nest_memory.sql` y a las edge functions (contrato en `docs/MEMORY_INTEGRATIONS_CONTRACT.md`).
- Todo módulo nuevo es **puro**: sin `fs`, sin `electron`, sin `better-sqlite3`. Solo `main.ts` toca efectos.
- Tests en `electron/__tests__/*.test.ts`, **nunca co-locados**. Import `../integrations/<mod>`.
- Comandos: `npm test` (= `vitest run`) o `npx vitest run <file>`.
- Código y comentarios **en inglés** (el resto de `electron/integrations/` lo está). Los docs, en español.
- Baseline de la suite antes de empezar: correr `npm test` y anotar el número. Ninguna tarea puede bajarlo.
- Nombres: prefijo `memory-` para lo nuestro. **Nunca `graph-`**: esos ocho archivos ya son del grafo de agentes y confundirlos es un costo permanente.

---

### Task 1: Puertos y procedencia

**Files:**
- Create: `electron/integrations/memory-port.ts`
- Create: `electron/integrations/memory-provenance.ts`
- Test: `electron/__tests__/memory-provenance.test.ts`

**Interfaces:**
- Consumes: `GraphRun`, `NodeRuntime` de `./graph-runner`; `GraphTemplate`, `GraphNode` de `./graph-template`
- Produces: `MemorySaveInput`, `MemorySink`, `NULL_SINK`, `provenanceBlock()`, `runLink()`

- [ ] **Step 1: Write the failing test**

```ts
// electron/__tests__/memory-provenance.test.ts
import { describe, it, expect } from 'vitest'
import { provenanceBlock, runLink } from '../integrations/memory-provenance'
import type { GraphRun } from '../integrations/graph-runner'

const run: GraphRun = {
  runId: 'r1', ticketId: 't-42', templateId: 'full', worktreePath: '/w', repoPath: '/repo',
  branch: 'feat/x', nodes: {}, startedAt: 0, mode: 'auto', round: 2,
}

describe('runLink', () => {
  it('builds a stable wikilink from the runId', () => {
    expect(runLink('r1')).toBe('[[run-r1]]')
  })
})

describe('provenanceBlock', () => {
  it('includes run, node, branch, ticket, round and the run wikilink', () => {
    const out = provenanceBlock(run, { nodeId: 'rev-security', role: 'reviewer', focus: 'security', verdict: 'blocking' })
    expect(out).toContain('run r1')
    expect(out).toContain('rev-security')
    expect(out).toContain('reviewer/security')
    expect(out).toContain('feat/x')
    expect(out).toContain('t-42')
    expect(out).toContain('Ronda: 2')
    expect(out).toContain('[[run-r1]]')
  })

  it('omits the node line when there is no node', () => {
    const out = provenanceBlock(run, {})
    expect(out).not.toContain('Nodo:')
    expect(out).toContain('[[run-r1]]')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/memory-provenance.test.ts`
Expected: FAIL, "Failed to resolve import ../integrations/memory-provenance"

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/integrations/memory-port.ts
// Injected port to Nest Memory. The store lives in feat/nest-memory-phase1 and this
// branch must not import it (see docs/MEMORY_INTEGRATIONS_CONTRACT.md) — same pattern
// Bauti used for PtyMemoryIntegration in pty-manager.ts.

export type MemoryObservationType =
  | 'decision' | 'bugfix' | 'architecture' | 'discovery'
  | 'pattern' | 'config' | 'preference' | 'session'

export interface MemorySaveInput {
  cwd: string
  title: string
  content: string
  type: MemoryObservationType
  topicKey?: string
  tags?: string[]
  sourceRef: string
  originAi?: string
  gitBranch?: string
}

export interface MemorySink {
  save(input: MemorySaveInput): void
}

/** Default when the memory branch isn't merged / memory is disconnected. */
export const NULL_SINK: MemorySink = { save: () => {} }
```

```ts
// electron/integrations/memory-provenance.ts
// Provenance is not decoration: if Integrations is going to DECIDE from memories, a
// reader (human or agent) needs to know a claim came from an automated reviewer in a
// run that was later approved anyway, versus from a human rejecting the change.
import type { GraphRun } from './graph-runner'

export interface ProvenanceSource {
  nodeId?: string
  role?: string
  focus?: string
  verdict?: 'blocking' | 'non-blocking' | 'human-approved' | 'human-rejected'
}

/** Stable, syncId-free link every memory of a run carries, so they converge on one
 *  node in a graph view. The run-close memory declares the same alias. */
export function runLink(runId: string): string {
  return `[[run-${runId}]]`
}

export function provenanceBlock(run: GraphRun, src: ProvenanceSource): string {
  const lines = ['---']
  if (src.nodeId) {
    const role = src.focus ? `${src.role}/${src.focus}` : src.role
    lines.push(`Nodo: ${src.nodeId} (${role})`)
  }
  lines.push(`Origen: run ${run.runId} · template ${run.templateId}`)
  lines.push(`Branch: ${run.branch} · Ticket: ${run.ticketId} · Ronda: ${run.round}`)
  if (src.verdict) lines.push(`Veredicto: ${src.verdict}`)
  lines.push(runLink(run.runId))
  return lines.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/memory-provenance.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/memory-port.ts electron/integrations/memory-provenance.ts electron/__tests__/memory-provenance.test.ts
git commit -m "feat(memory-bridge): puertos inyectados + bloque de procedencia"
```

---

### Task 2: Concerns bloqueantes desde el gate

**Files:**
- Create: `electron/integrations/memory-bridge.ts`
- Test: `electron/__tests__/memory-bridge.test.ts`

**Interfaces:**
- Consumes: `MemorySaveInput` de `./memory-port`; `provenanceBlock`, `runLink` de `./memory-provenance`
- Produces: `bridgeEvent(ev: DomainEvent, ctx: BridgeContext): MemorySaveInput[]`, `interface BridgeContext { getRun(ticketId: string): GraphRun | null; getTemplate(id: string): GraphTemplate | null }`

- [ ] **Step 1: Write the failing test**

```ts
// electron/__tests__/memory-bridge.test.ts
import { describe, it, expect } from 'vitest'
import { bridgeEvent, type BridgeContext } from '../integrations/memory-bridge'
import { defaultGraphTemplates } from '../integrations/graph-template'
import type { GraphRun, NodeRuntime } from '../integrations/graph-runner'

const full = defaultGraphTemplates().find((t) => t.id === 'full')!

const mkRun = (nodes: Record<string, NodeRuntime>): GraphRun => ({
  runId: 'r1', ticketId: 't-42', templateId: 'full', worktreePath: '/w', repoPath: '/repo',
  branch: 'feat/x', nodes, startedAt: 0, mode: 'auto', round: 0,
})

const ctxFor = (run: GraphRun): BridgeContext => ({
  getRun: () => run,
  getTemplate: () => full,
})

describe('bridgeEvent · gate_blocked', () => {
  it('emits one memory per blocking concern, not one per gate', () => {
    const run = mkRun({
      'rev-security': { state: 'done', verdict: { blocking: true, concerns: ['token logueado en claro', 'falta rate limit'] } },
    })
    const out = bridgeEvent(
      { type: 'graph.gate_blocked', ticketId: 't-42', gateId: 'gate', blockedBy: ['rev-security'] },
      ctxFor(run)
    )
    expect(out).toHaveLength(2)
    expect(out[0].title).toContain('token logueado en claro')
    expect(out[0].sourceRef).toBe('graph:r1:rev-security:0')
    expect(out[1].sourceRef).toBe('graph:r1:rev-security:1')
    expect(out[0].cwd).toBe('/repo')
    expect(out[0].gitBranch).toBe('feat/x')
    expect(out[0].content).toContain('[[run-r1]]')
    expect(out[0].tags).toContain('security')
  })

  it('uses bugfix for correctness-flavoured focus and discovery otherwise', () => {
    const run = mkRun({
      'rev-security': { state: 'done', verdict: { blocking: true, concerns: ['x'] } },
      'rev-perf': { state: 'done', verdict: { blocking: true, concerns: ['y'] } },
    })
    const sec = bridgeEvent({ type: 'graph.gate_blocked', ticketId: 't-42', gateId: 'gate', blockedBy: ['rev-security'] }, ctxFor(run))
    const perf = bridgeEvent({ type: 'graph.gate_blocked', ticketId: 't-42', gateId: 'gate', blockedBy: ['rev-perf'] }, ctxFor(run))
    expect(sec[0].type).toBe('bugfix')
    expect(perf[0].type).toBe('discovery')
  })

  it('produces nothing when the reviewer has no parsed verdict', () => {
    const run = mkRun({ 'rev-security': { state: 'done' } })
    const out = bridgeEvent({ type: 'graph.gate_blocked', ticketId: 't-42', gateId: 'gate', blockedBy: ['rev-security'] }, ctxFor(run))
    expect(out).toEqual([])
  })

  it('produces nothing when the run is unknown', () => {
    const out = bridgeEvent(
      { type: 'graph.gate_blocked', ticketId: 'nope', gateId: 'gate', blockedBy: ['rev-security'] },
      { getRun: () => null, getTemplate: () => full }
    )
    expect(out).toEqual([])
  })
})

describe('bridgeEvent · descartes', () => {
  it('ignores transient and milestone-only events', () => {
    const run = mkRun({})
    const ctx = ctxFor(run)
    expect(bridgeEvent({ type: 'graph.node_started', ticketId: 't-42', nodeId: 'coder', role: 'coder' }, ctx)).toEqual([])
    expect(bridgeEvent({ type: 'graph.node_needs_input', ticketId: 't-42', nodeId: 'coder', role: 'coder' }, ctx)).toEqual([])
    expect(bridgeEvent({ type: 'pr.opened', branch: 'feat/x', repoFullName: 'o/r' }, ctx)).toEqual([])
    expect(bridgeEvent({ type: 'session.opened', branch: 'feat/x', repoPath: '/repo' }, ctx)).toEqual([])
    expect(bridgeEvent({ type: 'block.started', label: 'focus' }, ctx)).toEqual([])
    expect(bridgeEvent({ type: 'review.requested', repoFullName: 'o/r', prNumber: 1, prTitle: 'x' }, ctx)).toEqual([])
    expect(bridgeEvent({ type: 'task.created', taskId: 'x', pluginId: 'p', providerId: 'q', repoFullName: 'o/r', branch: 'b' }, ctx)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/memory-bridge.test.ts`
Expected: FAIL, "Failed to resolve import ../integrations/memory-bridge"

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/integrations/memory-bridge.ts
// Pure translation of bus events + persisted GraphRun state into memory writes.
// The bus says WHEN; the run store says WHAT (NodeRuntime already carries the parsed
// verdict, summary, artifact path and exitCode — graph-runner.ts:26-35), so this module
// never touches the filesystem.
import type { DomainEvent } from './bus-types'
import type { GraphRun } from './graph-runner'
import type { GraphTemplate, GraphNode } from './graph-template'
import type { MemorySaveInput, MemoryObservationType } from './memory-port'
import { provenanceBlock, runLink } from './memory-provenance'

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
            sourceRef: `graph:${run.runId}:${nodeId}:${i}`,
            originAi: node?.agent,
            gitBranch: run.branch,
          })
        })
      }
      return out
    }
    default:
      return []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/memory-bridge.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/memory-bridge.ts electron/__tests__/memory-bridge.test.ts
git commit -m "feat(memory-bridge): una memoria por concern bloqueante"
```

---

### Task 3: Escalación del auto-repair

**Files:**
- Modify: `electron/integrations/memory-bridge.ts` (nuevo `case` en `bridgeEvent`)
- Modify: `electron/__tests__/memory-bridge.test.ts`

**Interfaces:**
- Consumes: `bridgeEvent`, `BridgeContext` de la Task 2
- Produces: nada nuevo; extiende `bridgeEvent`

- [ ] **Step 1: Write the failing test**

```ts
describe('bridgeEvent · escalated', () => {
  it('records the rounds and what each revision asked for', () => {
    const run = mkRun({ coder: { state: 'done' } })
    run.round = 3
    run.revisionNotes = { coder: 'el fix no cubre el caso de token vacio' }
    const out = bridgeEvent(
      { type: 'graph.escalated', ticketId: 't-42', gateId: 'gate', round: 3 },
      ctxFor(run)
    )
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('discovery')
    expect(out[0].sourceRef).toBe('graph:r1:escalated')
    expect(out[0].title).toContain('3')
    expect(out[0].content).toContain('el fix no cubre el caso de token vacio')
    expect(out[0].content).toContain('[[run-r1]]')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/memory-bridge.test.ts -t escalated`
Expected: FAIL, "expected [] to have a length of 1"

- [ ] **Step 3: Write minimal implementation**

Agregar antes del `default:` en `bridgeEvent`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/memory-bridge.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/memory-bridge.ts electron/__tests__/memory-bridge.test.ts
git commit -m "feat(memory-bridge): memoria de escalacion del auto-repair"
```

---

### Task 4: Decisiones humanas (approve y requestChanges)

**Files:**
- Modify: `electron/integrations/memory-bridge.ts`
- Modify: `electron/__tests__/memory-bridge.test.ts`

**Interfaces:**
- Produces: `bridgeDecision(decision: PendingDecision, run: GraphRun, template: GraphTemplate | null): MemorySaveInput[]`

Nota para el implementador: las decisiones humanas **no pasan por el bus**. Los handlers IPC (`main.ts:3048` y `:3052`) solo setean `run.pendingDecision`, y `planTick` la aplica después (`graph-orchestrator.ts:186`). Por eso esto es una función aparte de `bridgeEvent`, y en la Task 7 se engancha en el IPC, donde el estado previo a la decisión todavía existe.

- [ ] **Step 1: Write the failing test**

```ts
import { bridgeDecision } from '../integrations/memory-bridge'

describe('bridgeDecision · approve', () => {
  it('records which concerns a human accepted anyway', () => {
    const run = mkRun({
      'rev-security': { state: 'done', verdict: { blocking: true, concerns: ['token logueado en claro'] } },
      'rev-perf': { state: 'done', verdict: { blocking: false, concerns: [] } },
    })
    const out = bridgeDecision({ kind: 'approve', gateId: 'gate' }, run, full)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('decision')
    expect(out[0].sourceRef).toBe('graph:r1:approve:gate')
    expect(out[0].content).toContain('token logueado en claro')
    expect(out[0].content).toContain('human-approved')
  })

  it('produces nothing when the gate had no blocking concerns to override', () => {
    const run = mkRun({ 'rev-security': { state: 'done', verdict: { blocking: false, concerns: [] } } })
    expect(bridgeDecision({ kind: 'approve', gateId: 'gate' }, run, full)).toEqual([])
  })
})

describe('bridgeDecision · requestChanges', () => {
  it('keeps the human feedback verbatim and keys by round', () => {
    const run = mkRun({ coder: { state: 'done' } })
    run.round = 1
    const out = bridgeDecision({ kind: 'requestChanges', feedback: 'esto rompe el flujo de onboarding' }, run, full)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('decision')
    expect(out[0].sourceRef).toBe('graph:r1:changes:1')
    expect(out[0].content).toContain('esto rompe el flujo de onboarding')
    expect(out[0].content).toContain('human-rejected')
  })

  it('ignores empty feedback', () => {
    const run = mkRun({ coder: { state: 'done' } })
    expect(bridgeDecision({ kind: 'requestChanges', feedback: '   ' }, run, full)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/memory-bridge.test.ts -t bridgeDecision`
Expected: FAIL, "bridgeDecision is not a function"

- [ ] **Step 3: Write minimal implementation**

```ts
import type { PendingDecision } from './graph-runner'

/** Human judgement over machine judgement. This is the highest-value memory in the
 *  system and the one no MCP-only competitor can capture: an approve says "these
 *  concerns were not blocking in this context", which is what stops the reviewers
 *  from blocking on the same thing next run. */
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
        `Un humano aprobo el gate ${decision.gateId} sabiendo que estos concerns estaban ` +
        `marcados como bloqueantes. En este contexto no lo eran:\n${overridden.join('\n')}\n\n` +
        provenanceBlock(run, { nodeId: decision.gateId, role: 'gate', verdict: 'human-approved' }),
      type: 'decision',
      tags: ['graph', 'human-decision'],
      sourceRef: `graph:${run.runId}:approve:${decision.gateId}`,
      gitBranch: run.branch,
    }]
  }

  const feedback = decision.feedback.trim()
  if (!feedback) return []
  return [{
    cwd: cwdOf(run),
    title: `Cambios pedidos por un humano (ronda ${run.round})`,
    content: `${feedback}\n\n${provenanceBlock(run, { verdict: 'human-rejected' })}`,
    type: 'decision',
    tags: ['graph', 'human-decision'],
    sourceRef: `graph:${run.runId}:changes:${run.round}`,
    gitBranch: run.branch,
  }]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/memory-bridge.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/memory-bridge.ts electron/__tests__/memory-bridge.test.ts
git commit -m "feat(memory-bridge): capturar el juicio humano sobre el de la maquina"
```

---

### Task 5: Fallas duras (CI y errores detectados)

**Files:**
- Modify: `electron/integrations/memory-bridge.ts`
- Modify: `electron/__tests__/memory-bridge.test.ts`

**Interfaces:**
- Consumes: `bridgeEvent` de la Task 2
- Produces: nada nuevo

Nota: estos dos eventos **no dependen de un run**. Traen su propio `summary`, así que se traducen sin `BridgeContext` y funcionan aunque el evento no venga del graph.

- [ ] **Step 1: Write the failing test**

```ts
describe('bridgeEvent · fallas duras', () => {
  it('traduce ci.failed usando su propio summary', () => {
    const out = bridgeEvent(
      { type: 'ci.failed', branch: 'feat/x', repoFullName: 'o/r', runUrl: 'https://ci/1', summary: '3 tests rojos en auth' },
      ctxFor(mkRun({}))
    )
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('bugfix')
    expect(out[0].content).toContain('3 tests rojos en auth')
    expect(out[0].content).toContain('https://ci/1')
    expect(out[0].sourceRef).toBe('ci:o/r:feat/x:https://ci/1')
    expect(out[0].gitBranch).toBe('feat/x')
  })

  it('no produce memoria si ci.failed no trae summary', () => {
    const out = bridgeEvent({ type: 'ci.failed', branch: 'feat/x', repoFullName: 'o/r' }, ctxFor(mkRun({})))
    expect(out).toEqual([])
  })

  it('traduce error.detected', () => {
    const out = bridgeEvent(
      { type: 'error.detected', source: 'sentry', ref: 'ISSUE-9', summary: 'null deref en UserList' },
      ctxFor(mkRun({}))
    )
    expect(out).toHaveLength(1)
    expect(out[0].sourceRef).toBe('error:sentry:ISSUE-9')
    expect(out[0].content).toContain('null deref en UserList')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/memory-bridge.test.ts -t "fallas duras"`
Expected: FAIL, "expected [] to have a length of 1"

- [ ] **Step 3: Write minimal implementation**

Agregar antes del `default:`. `cwd` queda vacío a propósito: sin `repoPath` local no se puede resolver el proyecto, y el adapter lo resuelve por `repoFullName` o cae en `__global__`.

```ts
    case 'ci.failed': {
      if (!ev.summary) return []
      return [{
        cwd: '',
        title: `CI en rojo · ${ev.branch}`,
        content: `${ev.summary}${ev.runUrl ? `\n\nRun: ${ev.runUrl}` : ''}\n\n---\nRepo: ${ev.repoFullName} · Branch: ${ev.branch}`,
        type: 'bugfix',
        tags: ['ci', 'graph'],
        sourceRef: `ci:${ev.repoFullName}:${ev.branch}:${ev.runUrl ?? 'sin-url'}`,
        gitBranch: ev.branch,
      }]
    }

    case 'error.detected': {
      if (!ev.summary) return []
      return [{
        cwd: '',
        title: `Error detectado · ${ev.source}`,
        content: `${ev.summary}\n\n---\nFuente: ${ev.source} · Ref: ${ev.ref}`,
        type: 'bugfix',
        tags: ['error', ev.source],
        sourceRef: `error:${ev.source}:${ev.ref}`,
      }]
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/memory-bridge.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/memory-bridge.ts electron/__tests__/memory-bridge.test.ts
git commit -m "feat(memory-bridge): traducir ci.failed y error.detected"
```

---

### Task 6: Cierre de run y confirmación por merge

**Files:**
- Modify: `electron/integrations/memory-bridge.ts`
- Modify: `electron/__tests__/memory-bridge.test.ts`

**Interfaces:**
- Produces: extiende `bridgeEvent` con `graph.completed` y `pr.merged`

Nota clave: `pr.merged` **no crea** una memoria nueva. Re-emite la del cierre de run con la **misma `sourceRef`**, agregando que mergeó. El `save()` del store resuelve identidad por `source_ref` antes que nada (índice `UNIQUE (source, source_ref)`) y devuelve `source_ref_updated`, así que es una actualización in-place. Eso es lo que separa "un reviewer dijo X" de "un reviewer dijo X y el cambio entró igual".

- [ ] **Step 1: Write the failing test**

```ts
describe('bridgeEvent · cierre de run', () => {
  it('resume el run: nodos hechos, concerns y rondas', () => {
    const run = mkRun({
      coder: { state: 'done' },
      'rev-security': { state: 'done', verdict: { blocking: true, concerns: ['token en claro'] } },
      tester: { state: 'done', exitCode: 0 },
    })
    run.round = 2
    const out = bridgeEvent({ type: 'graph.completed', ticketId: 't-42', templateId: 'full' }, ctxFor(run))
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('session')
    expect(out[0].sourceRef).toBe('graph:r1:run')
    expect(out[0].content).toContain('token en claro')
    expect(out[0].content).toContain('t-42')
    expect(out[0].content).toContain('[[run-r1]]')
  })

  it('pr.merged reusa la sourceRef del cierre para actualizar, no duplicar', () => {
    const run = mkRun({ coder: { state: 'done' } })
    const out = bridgeEvent({ type: 'pr.merged', branch: 'feat/x', repoFullName: 'o/r' }, {
      getRun: () => run,
      getTemplate: () => full,
    })
    expect(out).toHaveLength(1)
    expect(out[0].sourceRef).toBe('graph:r1:run')
    expect(out[0].content).toContain('Mergeado')
  })

  it('pr.merged sin run asociado no produce nada', () => {
    const out = bridgeEvent({ type: 'pr.merged', branch: 'feat/x', repoFullName: 'o/r' }, {
      getRun: () => null, getTemplate: () => full,
    })
    expect(out).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/memory-bridge.test.ts -t "cierre de run"`
Expected: FAIL, "expected [] to have a length of 1"

- [ ] **Step 3: Write minimal implementation**

`BridgeContext.getRun` se busca por `ticketId` en los eventos de graph y por `branch` en `pr.merged`. Para no duplicar el puerto, la Task 7 inyecta un `getRun` que acepta cualquiera de los dos (`GraphRunStore.getByTicket` primero, y si falla busca por `run.branch`).

```ts
function runSummary(run: GraphRun, merged: boolean): string {
  const done = Object.entries(run.nodes).filter(([, rt]) => rt.state === 'done').map(([id]) => id)
  const concerns = Object.entries(run.nodes)
    .flatMap(([id, rt]) => (rt.verdict?.blocking ? rt.verdict.concerns.map((c) => `- ${id}: ${c}`) : []))
  return [
    `Ticket ${run.ticketId} · template ${run.templateId} · ${run.round + 1} ronda(s).`,
    `Nodos completados: ${done.join(', ') || 'ninguno'}.`,
    concerns.length ? `Concerns bloqueantes durante el run:\n${concerns.join('\n')}` : 'Sin concerns bloqueantes.',
    merged ? `Mergeado a ${run.branch}: el cambio sobrevivio.` : '',
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
```

Y los dos `case` antes del `default:`:

```ts
    case 'graph.completed': {
      const run = ctx.getRun(ev.ticketId)
      return run ? [runCloseMemory(run, false)] : []
    }

    case 'pr.merged': {
      const run = ctx.getRun(ev.branch)
      return run ? [runCloseMemory(run, true)] : []
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/memory-bridge.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/memory-bridge.ts electron/__tests__/memory-bridge.test.ts
git commit -m "feat(memory-bridge): cierre de run y confirmacion por merge"
```

---

### Task 7: Cableado en main.ts

**Files:**
- Modify: `electron/main.ts:2415` (fan-out del `setOnEmit` existente)
- Modify: `electron/main.ts:3048-3055` (los dos handlers IPC de decisión)

**Interfaces:**
- Consumes: `bridgeEvent`, `bridgeDecision`, `BridgeContext`, `NULL_SINK`

Esta tarea es la única con efectos y **no es testeable con vitest**. Verificación manual al final.

- [ ] **Step 1: Agregar el sink y el contexto**

Cerca de donde se crea `graphRunStore`, agregar:

```ts
import { bridgeEvent, bridgeDecision, type BridgeContext } from './integrations/memory-bridge'
import { NULL_SINK, type MemorySink } from './integrations/memory-port'

// Swapped for the real adapter over MemoryStore.save({source:'pty'}) once
// feat/nest-memory-phase1 merges. Until then the bridge runs and writes nowhere.
const memorySink: MemorySink = NULL_SINK

// getRun accepts a ticketId OR a branch: graph events carry ticketId, pr.merged carries
// the branch. Both resolve to the same run.
const bridgeCtx: BridgeContext = {
  getRun: (key) =>
    graphRunStore.getByTicket(key)?.run
    ?? graphRunStore.list().find((p) => p.run.branch === key)?.run
    ?? null,
  getTemplate: (id) => graphTemplateStore.list().find((t) => t.id === id) ?? null,
}
```

- [ ] **Step 2: Fan-out del observer del bus**

`setOnEmit` acepta **un solo** callback y el Activity log del Hub ya lo ocupa. No cambiar el bus: extender el callback existente en `main.ts:2415`.

```ts
eventBus.setOnEmit((ev) => {
  const ts = Date.now()
  activityLog.record(ev, ts)
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('activity:append', { ev, ts })
  // Memory bridge: best-effort, never breaks the activity rail.
  try {
    for (const input of bridgeEvent(ev, bridgeCtx)) memorySink.save(input)
  } catch (err) {
    console.warn('[memory-bridge] failed to translate event', ev.type, err)
  }
})
```

- [ ] **Step 3: Enganchar las dos decisiones humanas**

En los handlers IPC, **antes** de `graphRunStore.save(...)`, porque después el estado previo a la decisión se pierde:

```ts
ipcMain.handle('graph:gate:approve', (_e, runId: string, gateId: string) => {
  const p = graphRunStore.get(runId); if (!p) return { ok: false as const }
  try {
    const t = graphTemplateStore.list().find((x) => x.id === p.run.templateId) ?? null
    for (const input of bridgeDecision({ kind: 'approve', gateId }, p.run, t)) memorySink.save(input)
  } catch (err) { console.warn('[memory-bridge] approve', err) }
  graphRunStore.save({ ...p.run, pendingDecision: { kind: 'approve', gateId } }, p.seen); return { ok: true as const }
})

ipcMain.handle('graph:gate:requestChanges', (_e, runId: string, feedback: string) => {
  const p = graphRunStore.get(runId); if (!p) return { ok: false as const }
  try {
    const t = graphTemplateStore.list().find((x) => x.id === p.run.templateId) ?? null
    for (const input of bridgeDecision({ kind: 'requestChanges', feedback }, p.run, t)) memorySink.save(input)
  } catch (err) { console.warn('[memory-bridge] requestChanges', err) }
  graphRunStore.save({ ...p.run, pendingDecision: { kind: 'requestChanges', feedback } }, p.seen); return { ok: true as const }
})
```

- [ ] **Step 4: Verificar**

```bash
npx tsc -b
npm test
git clean -fd   # tsc -b emite .js/.d.ts junto a los sources (ver CLAUDE.md)
```

Expected: typecheck sin errores nuevos (hay ~15 preexistentes en código de main), y la suite igual o mayor al baseline anotado en Global Constraints.

⚠️ **`git add` de los archivos fuente NUEVOS ANTES del `git clean`** — clean borra todo lo untracked y no distingue un `.ts` recién creado de un `.js` emitido. Ya pasó una vez en este repo.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat(memory-bridge): cablear el puente al bus y a las decisiones humanas"
```

---

## Fuera de este plan

- **El adapter real del sink** sobre `MemoryStore`: depende de que `feat/nest-memory-phase1` se merge. Son ~20 líneas y una tarea aparte.
- **La forma #5 (resultado del tester)**: bloqueada por la decisión abierta de §7 del spec — el tester es nodo hoja y `composeNodeInput` solo pide artefacto `if (!isLeaf)`, así que hoy solo queda `exitCode`. Se implementa cuando Gero elija (a) pedirle el artefacto igual, o (b) conformarse con el exit code.
- **La forma #8 (template custom)** y **#9 (meeting, opt-in)**: valen poco sin las anteriores andando y la #9 necesita la UI de opt-in.
- **El vault markdown y la graph view**: specs propios.
