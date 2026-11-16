# H4 — GitHub señales accionable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer visible el estado de CI de cada worktree (badge) y accionable el rojo (log del run inyectado al agente), con las señales de CI/review viviendo en el main process.

**Architecture:** Módulo nuevo `worktree-signals.ts` en main poll-ea CI + reviews de cada worktree (token en main), expone el estado por IPC y emite `ci.failed` al bus (fuente única — se retira `checkCi` del ticket-loop). El renderer reusa `CIStatusBadge` alimentado por IPC; "arreglá el rojo" baja el log en main y lo inyecta al pane con `pty.write`.

**Tech Stack:** Electron (main/preload/renderer), TypeScript, React, vitest. GitHub REST API (Actions runs, PR reviews, job logs, search).

**Spec:** `docs/superpowers/specs/2026-07-30-h4-github-signals-design.md`

---

## File Structure

- Create: `electron/integrations/ci-status.ts` — helper puro `runsToStatus` (mapeo runs → CIStatus). Sin deps, testeable aislado.
- Create: `electron/integrations/worktree-signals.ts` — el motor: poll de CI/reviews por worktree, estado, emisión de `ci.failed`, armado del prompt de fix.
- Create: `electron/__tests__/ci-status.test.ts`, `electron/__tests__/worktree-signals.test.ts`.
- Modify: `electron/integrations/bus-types.ts` — tipos `ChangesRequestedEvent`, `ReviewRequestedEvent` + guards.
- Modify: `electron/ticket-loop.ts` — retirar `checkCi`/`ciNotified`/`FAILED_CI_CONCLUSIONS`/emisión `ci.failed`.
- Modify: `electron/__tests__/ticket-loop.test.ts` — quitar los tests de checkCi (migran al módulo nuevo).
- Modify: `electron/main.ts` — instanciar `worktreeSignals`, IPC handlers, poller.
- Modify: `electron/preload.ts` — `window.signals`.
- Modify: `src/types.ts` — tipo del bridge `signals` + `PaneNode.initialInput`.
- Create: `src/hooks/useWorktreeSignals.ts` — hook que consume IPC.
- Modify: `src/components/WorktreesSection.tsx` — badge por worktree.
- Modify: `src/App.tsx` + `src/components/TerminalPane.tsx` — `initialInput`/"arreglá el rojo".

---

## Task 1: Helper puro `runsToStatus`

**Files:**
- Create: `electron/integrations/ci-status.ts`
- Test: `electron/__tests__/ci-status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { runsToStatus, type WorkflowRun } from '../integrations/ci-status'

const run = (over: Partial<WorkflowRun>): WorkflowRun => ({
  id: 1, name: 'CI', status: 'completed', conclusion: 'success',
  html_url: 'u', head_branch: 'feat/x', ...over,
})

describe('runsToStatus', () => {
  it('sin runs → unknown', () => expect(runsToStatus([])).toBe('unknown'))
  it('último completado success → success', () =>
    expect(runsToStatus([run({ conclusion: 'success' })])).toBe('success'))
  it('último completado failure → failure', () =>
    expect(runsToStatus([run({ conclusion: 'failure' })])).toBe('failure'))
  it('in_progress → running', () =>
    expect(runsToStatus([run({ status: 'in_progress', conclusion: null })])).toBe('running'))
  it('queued → running', () =>
    expect(runsToStatus([run({ status: 'queued', conclusion: null })])).toBe('running'))
  it('cancelled/skipped → unknown', () =>
    expect(runsToStatus([run({ conclusion: 'cancelled' })])).toBe('unknown'))
  it('mira SOLO el primero (más reciente)', () =>
    expect(runsToStatus([run({ conclusion: 'failure' }), run({ conclusion: 'success' })])).toBe('failure'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/ci-status.test.ts`
Expected: FAIL (`Cannot find module '../integrations/ci-status'`).

- [ ] **Step 3: Write minimal implementation**

```ts
// Estado de CI derivado de los workflow runs de un branch. Extraído de
// src/hooks/useRepoCI.ts (misma semántica) para reusarlo en el main sin fetch.
export type CIStatus = 'success' | 'failure' | 'running' | 'unknown'

export interface WorkflowRun {
  id: number
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null
  html_url: string
  head_branch: string
}

/** El run más reciente (GitHub devuelve descendente por created_at) manda. */
export function runsToStatus(runs: WorkflowRun[]): CIStatus {
  const latest = runs[0]
  if (!latest) return 'unknown'
  if (latest.status === 'in_progress' || latest.status === 'queued') return 'running'
  if (latest.conclusion === 'success') return 'success'
  if (latest.conclusion === 'failure') return 'failure'
  return 'unknown'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/ci-status.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/ci-status.ts electron/__tests__/ci-status.test.ts
git commit -m "feat(h4): helper puro runsToStatus (runs GitHub → CIStatus)"
```

---

## Task 2: Motor `worktree-signals` — poll de CI por worktree

**Files:**
- Create: `electron/integrations/worktree-signals.ts`
- Test: `electron/__tests__/worktree-signals.test.ts`

Contexto: reusa `PanelAdapterDeps` (`getToken`/`getConfig`/`fetch`) y el bus (`EventBus.emit`, opcional/aditivo como en ticket-loop). Recibe la lista de worktrees `{ repoPath, branch }[]` inyectada (no importa worktree-store para no acoplar; main le pasa `worktreeStore.list()` mapeado). Resuelve `owner/repo` con una función inyectada `resolveRepo(repoPath) → "owner/repo" | null` (en main = `getRemoteUrl`+`parseOwnerRepo`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { WorktreeSignals } from '../integrations/worktree-signals'
import type { PanelAdapterDeps } from '../integration-panels'

function depsWith(fetchImpl: (url: string) => Promise<Response>): PanelAdapterDeps {
  return { getToken: () => 'tok', getConfig: () => ({}), fetch: vi.fn(fetchImpl) } as unknown as PanelAdapterDeps
}
const runsResp = (concl: string | null, status = 'completed') =>
  new Response(JSON.stringify({ workflow_runs: [{ id: 9, name: 'CI', status, conclusion: concl, html_url: 'r', head_branch: 'feat/x' }] }), { status: 200 })
const noReviews = new Response('[]', { status: 200 })

describe('WorktreeSignals — CI por worktree', () => {
  it('poll resuelve el estado de CI del branch y lo expone por get()', async () => {
    const deps = depsWith(async (url) => {
      if (url.includes('/actions/runs')) return runsResp('failure')
      return noReviews
    })
    const s = new WorktreeSignals(() => 'acme/app')
    await s.poll([{ repoPath: '/wt/x', branch: 'feat/x' }], deps)
    expect(s.get('/wt/x')?.ci).toBe('failure')
  })

  it('salta worktrees cuyo remote no resuelve a owner/repo (no GitHub)', async () => {
    const fetchMock = vi.fn()
    const deps = { getToken: () => 'tok', getConfig: () => ({}), fetch: fetchMock } as unknown as PanelAdapterDeps
    const s = new WorktreeSignals(() => null)
    await s.poll([{ repoPath: '/wt/x', branch: 'feat/x' }], deps)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(s.get('/wt/x')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/worktree-signals.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Write minimal implementation**

```ts
// Motor 3 (H4) — señales por worktree. Observa el estado de CI y de review de
// cada worktree vivo (token en main, credential-free vía deps) y lo expone por
// get() para la UI. Fuente única de la señal `ci.failed` del bus. No importa
// worktree-store ni electron: la lista de worktrees y la resolución de repo se
// inyectan (testeable en node puro).
import type { PanelAdapterDeps } from '../integration-panels'
import type { EventBus } from './event-bus'
import type { DomainEvent } from './bus-types'
import { runsToStatus, type CIStatus, type WorkflowRun } from './ci-status'

const FAILED_CI_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', 'timed_out', 'startup_failure'])
const GH = 'https://api.github.com'

export interface WorktreeInput { repoPath: string; branch: string }

export interface WorktreeSignal {
  ci: CIStatus
  runId?: number
  runUrl?: string
  changesRequested: boolean
  prNumber?: number
}

/** repoPath → "owner/repo" | null (no-GitHub). En main: getRemoteUrl+parseOwnerRepo. */
export type ResolveRepo = (repoPath: string) => string | null

export class WorktreeSignals {
  private state = new Map<string, WorktreeSignal>()
  private ciNotified = new Map<string, string>() // repoPath → sha ya emitido
  private bus?: EventBus

  constructor(private resolveRepo: ResolveRepo) {}

  attachBus(bus?: EventBus): void { this.bus = bus }
  get(repoPath: string): WorktreeSignal | undefined { return this.state.get(repoPath) }
  list(): Array<{ repoPath: string } & WorktreeSignal> {
    return [...this.state].map(([repoPath, s]) => ({ repoPath, ...s }))
  }

  private async gh<T>(deps: PanelAdapterDeps, path: string): Promise<T | null> {
    const res = await deps.fetch(`${GH}${path}`, {
      headers: { Authorization: `Bearer ${deps.getToken('github')}`, Accept: 'application/vnd.github.v3+json' },
    })
    if (!res.ok) return null
    return res.json() as Promise<T>
  }

  async poll(worktrees: WorktreeInput[], deps: PanelAdapterDeps): Promise<void> {
    for (const wt of worktrees) {
      const repo = this.resolveRepo(wt.repoPath)
      if (!repo) continue
      try {
        await this.pollOne(wt, repo, deps)
      } catch (err) {
        console.warn('[worktree-signals] poll failed', wt.repoPath, err)
      }
    }
  }

  private async pollOne(wt: WorktreeInput, repo: string, deps: PanelAdapterDeps): Promise<void> {
    const runsJson = await this.gh<{ workflow_runs?: WorkflowRun[] }>(
      deps, `/repos/${repo}/actions/runs?branch=${encodeURIComponent(wt.branch)}&per_page=5`,
    )
    const runs = runsJson?.workflow_runs ?? []
    const ci = runsToStatus(runs)
    const failedRun = runs.find((r) => r.status === 'completed' && FAILED_CI_CONCLUSIONS.has(r.conclusion ?? ''))
    const prev = this.state.get(wt.repoPath)
    this.state.set(wt.repoPath, {
      ci,
      runId: failedRun?.id,
      runUrl: failedRun?.html_url,
      changesRequested: prev?.changesRequested ?? false,
      prNumber: prev?.prNumber,
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/worktree-signals.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/worktree-signals.ts electron/__tests__/worktree-signals.test.ts
git commit -m "feat(h4): WorktreeSignals — poll de estado de CI por worktree"
```

---

## Task 3: changes_requested, PR number y emisión de `ci.failed`

**Files:**
- Modify: `electron/integrations/worktree-signals.ts`
- Test: `electron/__tests__/worktree-signals.test.ts`

- [ ] **Step 1: Write the failing test** (agregar al describe existente)

```ts
const prResp = (n: number) => new Response(JSON.stringify([{ number: n, head: { ref: 'feat/x' } }]), { status: 200 })
const reviewsResp = (state: string) => new Response(JSON.stringify([
  { user: { login: 'a' }, state: 'COMMENTED', submitted_at: '2026-01-01T00:00:00Z' },
  { user: { login: 'a' }, state, submitted_at: '2026-01-02T00:00:00Z' },
]), { status: 200 })

it('detecta changes_requested del review más reciente por autor', async () => {
  const deps = depsWith(async (url) => {
    if (url.includes('/actions/runs')) return runsResp('success')
    if (url.includes('/pulls?')) return prResp(42)
    if (url.includes('/reviews')) return reviewsResp('CHANGES_REQUESTED')
    return new Response('[]', { status: 200 })
  })
  const s = new WorktreeSignals(() => 'acme/app')
  await s.poll([{ repoPath: '/wt/x', branch: 'feat/x' }], deps)
  expect(s.get('/wt/x')).toMatchObject({ changesRequested: true, prNumber: 42 })
})

it('emite ci.failed una sola vez por SHA rojo (dedup)', async () => {
  const deps = depsWith(async (url) => {
    if (url.includes('/actions/runs')) return new Response(JSON.stringify({ workflow_runs: [
      { id: 9, name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'r', head_branch: 'feat/x', head_sha: 'abc' },
    ] }), { status: 200 })
    return new Response('[]', { status: 200 })
  })
  const emit = vi.fn(async () => ({ commands: [], failed: [] }))
  const s = new WorktreeSignals(() => 'acme/app')
  s.attachBus({ emit } as unknown as import('../integrations/event-bus').EventBus)
  const wts = [{ repoPath: '/wt/x', branch: 'feat/x' }]
  await s.poll(wts, deps)
  await s.poll(wts, deps) // mismo SHA rojo
  const ciFailed = emit.mock.calls.filter((c) => (c[0] as { type: string }).type === 'ci.failed')
  expect(ciFailed).toHaveLength(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/worktree-signals.test.ts`
Expected: FAIL (changesRequested siempre false; no emite ci.failed).

- [ ] **Step 3: Extend implementation**

Añadir `head_sha?: string` a `WorkflowRun` en `ci-status.ts`. En `pollOne`, tras calcular `ci`/`failedRun`:

```ts
    // PR abierto del branch → número + reviews (changes requested).
    let changesRequested = false
    let prNumber: number | undefined
    const owner = repo.split('/')[0]
    const pulls = await this.gh<Array<{ number: number; head: { ref: string } }>>(
      deps, `/repos/${repo}/pulls?head=${encodeURIComponent(owner + ':' + wt.branch)}&state=open&per_page=1`,
    )
    const pr = pulls?.[0]
    if (pr) {
      prNumber = pr.number
      const reviews = await this.gh<Array<{ user: { login: string } | null; state: string; submitted_at: string }>>(
        deps, `/repos/${repo}/pulls/${pr.number}/reviews`,
      )
      changesRequested = latestReviewIsChangesRequested(reviews ?? [])
    }
    this.state.set(wt.repoPath, { ci, runId: failedRun?.id, runUrl: failedRun?.html_url, changesRequested, prNumber })

    // Señal ci.failed (bus, aditiva, dedup por SHA del run rojo).
    const sha = (failedRun as { head_sha?: string } | undefined)?.head_sha
    if (this.bus && failedRun && sha && this.ciNotified.get(wt.repoPath) !== sha) {
      this.ciNotified.set(wt.repoPath, sha)
      const ev: DomainEvent = {
        type: 'ci.failed', branch: wt.branch, repoFullName: repo,
        ...(failedRun.html_url ? { runUrl: failedRun.html_url } : {}),
        ...(failedRun.name ? { summary: failedRun.name } : {}),
      }
      await this.bus.emit(ev, deps)
    }
```

Y el helper (module scope, exportado para test directo si se quiere):

```ts
// El review que cuenta es el más reciente por autor: un CHANGES_REQUESTED viejo
// que ya fue re-aprobado no debe marcar el PR. Sólo estados de decisión
// (APPROVED/CHANGES_REQUESTED) pisan; COMMENTED/DISMISSED se ignoran.
export function latestReviewIsChangesRequested(
  reviews: Array<{ user: { login: string } | null; state: string; submitted_at: string }>,
): boolean {
  const byAuthor = new Map<string, string>()
  for (const r of [...reviews].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))) {
    const login = r.user?.login
    if (!login) continue
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED') byAuthor.set(login, r.state)
  }
  return [...byAuthor.values()].includes('CHANGES_REQUESTED')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/worktree-signals.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/worktree-signals.ts electron/integrations/ci-status.ts electron/__tests__/worktree-signals.test.ts
git commit -m "feat(h4): changes_requested + emisión dedup de ci.failed desde el motor"
```

---

## Task 4: Retirar `checkCi` del ticket-loop (fuente única)

**Files:**
- Modify: `electron/ticket-loop.ts` (borrar `checkCi`, `ciNotified`, `FAILED_CI_CONCLUSIONS`, la rama `if (this.bus) await this.checkCi(...)` en `pollOnce`, y el import de `DomainEvent` si queda sin uso — verificar que `startWork`/`onPrStateChanged` lo siguen usando: SÍ, así que el import queda).
- Modify: `electron/__tests__/ticket-loop.test.ts` (borrar el describe "TicketLoop señal CI (ci.failed) en pollOnce").

- [ ] **Step 1:** Borrar en `ticket-loop.ts`: la constante `FAILED_CI_CONCLUSIONS` (líneas ~9-10), el campo `ciNotified` y su comentario (~40-46), el bloque de llamada a `checkCi` dentro de `pollOnce` (`if (this.bus) await this.checkCi(...)` y su comentario), y todo el método `private async checkCi(...)`. Dejar `pollOnce` terminando el branch `open` en `await this.onPrStateChanged(branch, 'open', deps)`.

- [ ] **Step 2:** Borrar en `ticket-loop.test.ts` el bloque `describe('TicketLoop señal CI (ci.failed) en pollOnce', ...)` completo (desde su comentario T8 hasta su cierre).

- [ ] **Step 3: Run tests**

Run: `npx vitest run electron/__tests__/ticket-loop.test.ts`
Expected: PASS (sin los tests de CI; las transiciones siguen verdes).

- [ ] **Step 4: Commit**

```bash
git add electron/ticket-loop.ts electron/__tests__/ticket-loop.test.ts
git commit -m "refactor(h4): retirar checkCi del ticket-loop — CI ahora es fuente única en worktree-signals"
```

---

## Task 5: Eventos nuevos del bus `changes.requested` / `review.requested`

**Files:**
- Modify: `electron/integrations/bus-types.ts`
- Test: `electron/__tests__/bus-types.test.ts` (agregar casos)

- [ ] **Step 1: Write the failing test** (en el describe de `isDomainEvent`)

```ts
it('changes.requested válido', () => {
  expect(isDomainEvent({ type: 'changes.requested', branch: 'feat/x', repoFullName: 'o/r', prNumber: 5 })).toBe(true)
  expect(isDomainEvent({ type: 'changes.requested', branch: 'feat/x', repoFullName: 'o/r' })).toBe(false)
})
it('review.requested válido', () => {
  expect(isDomainEvent({ type: 'review.requested', repoFullName: 'o/r', prNumber: 5, prTitle: 'x' })).toBe(true)
  expect(isDomainEvent({ type: 'review.requested', repoFullName: 'o/r', prNumber: 5 })).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/bus-types.test.ts`
Expected: FAIL (los dos `true` dan false — tipos no reconocidos).

- [ ] **Step 3: Implementation** — agregar interfaces, unión, guards:

```ts
export interface ChangesRequestedEvent {
  type: 'changes.requested'
  branch: string
  repoFullName: string
  prNumber: number
}

export interface ReviewRequestedEvent {
  type: 'review.requested'
  repoFullName: string
  prNumber: number
  prTitle: string
}
```

Añadir ambos a `export type DomainEvent = ... | ChangesRequestedEvent | ReviewRequestedEvent`. En `isDomainEvent` agregar:

```ts
    case 'changes.requested':
      return isStr(e.branch) && isStr(e.repoFullName) && typeof e.prNumber === 'number'
    case 'review.requested':
      return isStr(e.repoFullName) && typeof e.prNumber === 'number' && isStr(e.prTitle)
```

(No hace falta tocar `recipes.ts`: sin receta que los matchee, no producen comando — su consumo es H5.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/bus-types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/bus-types.ts electron/__tests__/bus-types.test.ts
git commit -m "feat(h4): tipos de evento changes.requested / review.requested (consumo en H5)"
```

---

## Task 6: "Arreglá el rojo" — `fixCiPrompt` en el motor

**Files:**
- Modify: `electron/integrations/worktree-signals.ts`
- Test: `electron/__tests__/worktree-signals.test.ts`

Baja el log del primer job fallido del run rojo del worktree y arma un prompt. `actions/runs/<id>/jobs` → primer job con `conclusion:'failure'` → `jobs/<jobId>/logs` (texto). Trunca a las últimas 200 líneas.

- [ ] **Step 1: Write the failing test**

```ts
it('fixCiPrompt arma prompt con el título del run, la URL y el log truncado', async () => {
  const bigLog = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n')
  const deps = depsWith(async (url) => {
    if (url.includes('/actions/runs?')) return new Response(JSON.stringify({ workflow_runs: [
      { id: 77, name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'https://run', head_branch: 'feat/x', head_sha: 's' },
    ] }), { status: 200 })
    if (url.endsWith('/runs/77/jobs')) return new Response(JSON.stringify({ jobs: [
      { id: 5, conclusion: 'success' }, { id: 6, conclusion: 'failure' },
    ] }), { status: 200 })
    if (url.endsWith('/jobs/6/logs')) return new Response(bigLog, { status: 200 })
    return new Response('[]', { status: 200 })
  })
  const s = new WorktreeSignals(() => 'acme/app')
  await s.poll([{ repoPath: '/wt/x', branch: 'feat/x' }], deps)
  const prompt = await s.fixCiPrompt('/wt/x', deps)
  expect(prompt).toContain('https://run')
  expect(prompt).toContain('line 299')       // últimas líneas presentes
  expect(prompt).not.toContain('line 99')     // truncado (fuera de las últimas 200)
})

it('fixCiPrompt devuelve null si el worktree no tiene run rojo', async () => {
  const s = new WorktreeSignals(() => 'acme/app')
  expect(await s.fixCiPrompt('/desconocido', depsWith(async () => new Response('{}', { status: 200 })))).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/worktree-signals.test.ts`
Expected: FAIL (`fixCiPrompt` no existe).

- [ ] **Step 3: Implementation** — agregar a la clase (necesita guardar el `repo` por worktree; extender `WorktreeSignal` con `repo?: string` seteado en `pollOne`):

```ts
  async fixCiPrompt(repoPath: string, deps: PanelAdapterDeps): Promise<string | null> {
    const sig = this.state.get(repoPath)
    if (!sig?.runId || !sig.repo) return null
    const jobs = await this.gh<{ jobs?: Array<{ id: number; conclusion: string | null }> }>(
      deps, `/repos/${sig.repo}/actions/runs/${sig.runId}/jobs`,
    )
    const failedJob = (jobs?.jobs ?? []).find((j) => j.conclusion === 'failure')
    let log = ''
    if (failedJob) {
      const res = await deps.fetch(`${GH}/repos/${sig.repo}/actions/jobs/${failedJob.id}/logs`, {
        headers: { Authorization: `Bearer ${deps.getToken('github')}`, Accept: 'application/vnd.github.v3+json' },
      })
      if (res.ok) log = truncateTail(await res.text(), 200)
    }
    return [
      `El CI de este branch (${sig.runUrl ?? 'run'}) está en rojo. Arreglá lo que rompió.`,
      log ? `\nÚltimas líneas del log del job fallido:\n\`\`\`\n${log}\n\`\`\`` : '',
    ].join('\n')
  }
```

Helper module-scope:

```ts
export function truncateTail(text: string, maxLines: number): string {
  const lines = text.split('\n')
  return lines.length <= maxLines ? text : lines.slice(-maxLines).join('\n')
}
```

Y en `pollOne`, incluir `repo` en el objeto guardado: `this.state.set(wt.repoPath, { ci, repo, runId: ..., ... })`. Añadir `repo?: string` a `WorktreeSignal`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/worktree-signals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/worktree-signals.ts electron/__tests__/worktree-signals.test.ts
git commit -m "feat(h4): fixCiPrompt — log del job fallido inyectable como prompt"
```

---

## Task 7: Wiring IPC en main + preload + poller

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1:** En `main.ts`, tras el wiring del bus (`ticketLoop.attachBus(eventBus)` ~línea 2283) y la def de `panelDeps` (~2287), instanciar el motor y arrancarlo. Reusa `getRemoteUrl`/`parseOwnerRepo` (ya importados de `./integrations/github` para `tickets:startWork`).

```ts
import { WorktreeSignals } from './integrations/worktree-signals'
// ...
const worktreeSignals = new WorktreeSignals((repoPath) => {
  const url = getRemoteUrl(repoPath)
  const or = url ? parseOwnerRepo(url) : null
  return or ? `${or.owner}/${or.repo}` : null
})
worktreeSignals.attachBus(eventBus)
```

- [ ] **Step 2:** IPC handlers (junto a los de `tickets:*`):

```ts
ipcMain.handle('signals:list', () => worktreeSignals.list())
ipcMain.handle('signals:fixCiPrompt', (_e, repoPath: string) =>
  typeof repoPath === 'string' ? worktreeSignals.fixCiPrompt(repoPath, panelDeps()) : Promise.resolve(null))
```

- [ ] **Step 3:** Poller — extender el `setInterval` de `TICKET_POLL_MS` (~2345) para pollear también las señales, y notificar al renderer al terminar:

```ts
let ticketPollInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
  for (const repoFullName of ticketLoop.trackedRepos()) {
    void ticketLoop.pollOnce(repoFullName, panelDeps())
  }
  void worktreeSignals
    .poll(worktreeStore.list().map((m) => ({ repoPath: m.repoPath, branch: m.branch })), panelDeps())
    .then(() => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('signals:update') })
}, TICKET_POLL_MS)
```

(Verificar que `BrowserWindow` esté importado en main.ts — lo está para la ventana principal.)

- [ ] **Step 4:** En `preload.ts`, junto a `window.tickets` (~277-283):

```ts
contextBridge.exposeInMainWorld('signals', {
  list: () => ipcRenderer.invoke('signals:list'),
  fixCiPrompt: (repoPath: string) => ipcRenderer.invoke('signals:fixCiPrompt', repoPath),
  onUpdate: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('signals:update', h)
    return () => ipcRenderer.removeListener('signals:update', h)
  },
})
```

- [ ] **Step 5: Verify build (no test — es wiring)**

Run: `npx vitest run` (asegura que nada se rompió) y `npx tsc --noEmit -p tsconfig.node.json 2>&1 | grep -E "worktree-signals|main.ts|preload" | grep -v "import.meta|OpenDialogOptions" || echo OK`
Expected: suite verde; sin errores TS nuevos en los archivos tocados.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat(h4): IPC signals:list/fixCiPrompt + poller de señales por worktree"
```

---

## Task 8: Hook + badge en el renderer

**Files:**
- Create: `src/hooks/useWorktreeSignals.ts`
- Modify: `src/types.ts` (tipo del bridge `signals`)
- Modify: `src/components/WorktreesSection.tsx`

- [ ] **Step 1:** En `src/types.ts`, agregar al tipo del bridge/window:

```ts
export interface WorktreeSignalDTO {
  repoPath: string
  ci: 'success' | 'failure' | 'running' | 'unknown'
  runId?: number
  runUrl?: string
  changesRequested: boolean
  prNumber?: number
}
// en la interfaz global del bridge:
signals: {
  list: () => Promise<WorktreeSignalDTO[]>
  fixCiPrompt: (repoPath: string) => Promise<string | null>
  onUpdate: (cb: () => void) => () => void
}
```

- [ ] **Step 2:** Crear `src/hooks/useWorktreeSignals.ts`:

```ts
import { useState, useEffect, useCallback } from 'react'
import type { WorktreeSignalDTO } from '../types'

// Estado de señales por worktree (repoPath → señal). Se llena por IPC y se
// refresca cuando el poller de main emite 'signals:update'. Token en main.
export function useWorktreeSignals(): Record<string, WorktreeSignalDTO> {
  const [byPath, setByPath] = useState<Record<string, WorktreeSignalDTO>>({})
  const refresh = useCallback(async () => {
    const list = await window.signals.list().catch(() => [])
    setByPath(Object.fromEntries(list.map((s) => [s.repoPath, s])))
  }, [])
  useEffect(() => {
    refresh()
    return window.signals.onUpdate(refresh)
  }, [refresh])
  return byPath
}
```

- [ ] **Step 3:** En `WorktreesSection.tsx`: importar `useWorktreeSignals` y `CIStatusBadge`, llamar el hook arriba (`const signals = useWorktreeSignals()`), y en el render (tras `wt-pr-chip`, ~línea 289) agregar el badge:

```tsx
{!isRoot && signals[wt.repoPath]?.ci && signals[wt.repoPath].ci !== 'unknown' && (
  <CIStatusBadge
    status={signals[wt.repoPath].ci}
    onClick={signals[wt.repoPath].ci === 'failure' ? () => onFixCi(wt.repoPath) : undefined}
  />
)}
{!isRoot && signals[wt.repoPath]?.changesRequested && (
  <span className="wt-changes-chip" title="Changes requested">⤺</span>
)}
```

`onFixCi` es un prop nuevo de `WorktreesSection` (lo cablea App en Task 9). Añadir `onFixCi: (repoPath: string) => void` a los props del componente.

- [ ] **Step 4: Run tests / typecheck**

Run: `npx vitest run` (nada se rompe) y verificar que `WorktreesSection` compila (`npx tsc --noEmit -p tsconfig.web.json 2>&1 | grep WorktreesSection || echo OK`).
Expected: verde / OK.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWorktreeSignals.ts src/types.ts src/components/WorktreesSection.tsx
git commit -m "feat(h4): badge de CI por worktree (IPC signals) + chip changes-requested"
```

---

## Task 9: "Arreglá el rojo" en el renderer (inyección al pane)

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/TerminalPane.tsx`
- Modify: `src/types.ts` (`PaneNode.initialInput`)

- [ ] **Step 1:** En `src/types.ts`, añadir a `PaneNode`: `initialInput?: string`.

- [ ] **Step 2:** En `TerminalPane.tsx`, tras crear el PTY (`window.pty.create(...)`, ~línea 264), inyectar el input pendiente una sola vez cuando llega el primer output del agente (señal de que arrancó). Usar el listener `pty:data` existente: la primera vez que `pane.initialInput` está seteado y llega data, escribir y limpiar un flag local:

```ts
// dentro del efecto que registra window.pty.onData / el handler de datos:
const injectedRef = useRef(false)
// ...en el callback de datos entrantes, al principio:
if (pane.initialInput && !injectedRef.current) {
  injectedRef.current = true
  setTimeout(() => window.pty.write(pane.id, pane.initialInput! + '\r'), 400)
}
```

(Buscar el punto donde `TerminalPane` ya consume `pty:data`/`onData`; agregar ahí. El `setTimeout` de 400ms da aire al REPL del agente para montar el prompt.)

- [ ] **Step 3:** En `App.tsx`, definir `onFixCi` y pasarlo a `<Sidebar>`/`<WorktreesSection>` y cablear `initialInput` en `addPane`:
  - `addPane`: aceptar el `initialInput` desde `addingPaneRef.current?.initialInput` y ponerlo en el `PaneNode` (junto a `repoPath`). Extender `addingPane` state a `{ worktreePath?: string; initialInput?: string }`.
  - `onFixCi(repoPath)`:

```ts
const onFixCi = useCallback(async (worktreePath: string) => {
  const prompt = await window.signals.fixCiPrompt(worktreePath).catch(() => null)
  if (!prompt) return
  const existing = panesRef.current.find((p) => p.repoPath === worktreePath)
  if (existing) {
    window.pty.write(existing.id, prompt + '\r')
    setFocusedPaneId(existing.id)
  } else {
    setAddingPane({ worktreePath, initialInput: prompt })
  }
}, [])
```

  Pasar `onFixCi` por la cadena `Sidebar → WorktreesSection` (agregar el prop en `Sidebar.tsx` y reenviarlo).

- [ ] **Step 4: Verify**

Run: `npx vitest run` y typecheck web (`npx tsc --noEmit -p tsconfig.web.json 2>&1 | grep -E "App.tsx|TerminalPane|Sidebar" || echo OK`).
Expected: suite verde; sin errores TS nuevos en los tocados.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/TerminalPane.tsx src/components/Sidebar.tsx src/types.ts
git commit -m "feat(h4): 'arreglá el rojo' — inyecta el log del run fallido al pane del worktree"
```

---

## Self-Review (hecho)

- **Spec coverage:** badge (Task 8) · señales CI+changes (Tasks 2-3) · review.requested tipo (Task 5) · arreglá el rojo (Tasks 6, 9) · fuente única CI (Task 4) · IPC (Task 7). ✅
- **Placeholder scan:** sin TBD; los tests traen código real.
- **Type consistency:** `CIStatus`/`WorkflowRun` (ci-status.ts) reusados; `WorktreeSignal`/`WorktreeSignalDTO` alineados (mismos campos); `signals.list/fixCiPrompt/onUpdate` idénticos en preload/types/hook.
- **Nota de review.requested:** el motor tipa el evento pero su detección/emisión efectiva y la UI de "te pidieron revisar" quedan para H5 (evita superficie huérfana en H4). Si al testear H4 se quiere el indicador global, es un follow-up chico.
