# Worker-Spec Cooperative Handoff (Capa 2 / B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Depends on:** `2026-08-11-worker-spec-model-per-task.md` (Capa 1) — implement that first. This plan reuses `WorkerSpec.steps[]`, `appendModelFlag`, and the worker library UI from Capa 1.

**Goal:** Let a worker-spec define an ordered pipeline of agents (e.g. cheap-model "explore" → strong-model "implement") that cooperate on ONE task by handing context through `.nest/handoff.md`, reusing the existing `initialInput` seeding path.

**Architecture:** Agents run **sequentially in the same worktree** (no git conflict). A non-final step's instructions are augmented to tell the agent to write `.nest/handoff.md` when done. An explicit "Hand off →" action (optionally auto-triggered by a file watcher) reads the handoff and opens the next step's pane seeded with it. This is cooperation (context sharing), not Orca's competitive race-and-merge; it also cuts tokens (the strong model starts from a lean, pre-digested summary).

**Tech Stack:** Electron + React + TypeScript, vitest, node-pty, `fs`.

**Spec:** `docs/superpowers/specs/2026-08-11-worker-spec-model-per-task-design.md` §6c.

---

## File Structure

| File | Responsibility |
|---|---|
| `electron/integrations/handoff.ts` **(new)** | `writeHandoff`/`readHandoff` for `.nest/handoff.md` |
| `electron/__tests__/handoff.test.ts` **(new)** | Unit tests for the handoff file helpers |
| `src/lib/worker-run.ts` **(new)** | Pure `composeStepInput` + `nextStep` (pipeline logic) |
| `src/lib/__tests__/worker-run.test.ts` **(new)** | Unit tests for the pipeline logic |
| `electron/main.ts` | `handoff:read` IPC (+ `handoff:write` for tests/manual) |
| `electron/preload.ts` | expose `window.handoff` |
| `src/components/AutomationsView.tsx` | worker editor gains add/remove **steps** (multi-agent pipeline) |
| `src/App.tsx` | track `activeWorkerRun` per worktree; "Hand off →" advances to the next step |
| `src/components/TerminalPane.tsx` (or pane header) | render the "Hand off →" button when a next step exists |

---

## Task 1: Handoff file helpers

**Files:**
- Create: `electron/integrations/handoff.ts`
- Test: `electron/__tests__/handoff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// electron/__tests__/handoff.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeHandoff, readHandoff } from '../integrations/handoff'

const dirs: string[] = []
function tmpWorktree(): string { const d = mkdtempSync(join(tmpdir(), 'handoff-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) { try { rmSync(dirs.pop()!, { recursive: true, force: true }) } catch { /* ignore */ } } })

describe('handoff file', () => {
  it('read returns null when no handoff exists', () => {
    expect(readHandoff(tmpWorktree())).toBeNull()
  })
  it('write then read round-trips, creating .nest/', () => {
    const wt = tmpWorktree()
    writeHandoff(wt, 'Explored auth.ts; the bug is a missing await on line 42.')
    expect(readHandoff(wt)).toBe('Explored auth.ts; the bug is a missing await on line 42.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/handoff.test.ts`
Expected: FAIL — cannot resolve `../integrations/handoff`.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/integrations/handoff.ts
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

function handoffPath(worktreePath: string): string {
  return join(worktreePath, '.nest', 'handoff.md')
}

/** Read the current handoff summary for a worktree, or null if none written yet. */
export function readHandoff(worktreePath: string): string | null {
  try { return readFileSync(handoffPath(worktreePath), 'utf8') } catch { return null }
}

/** Write/overwrite the handoff summary. Creates .nest/ if missing (same as
 *  startWorkOnWorktree's TASK.md write). Best-effort: a disk failure warns
 *  instead of throwing into the IPC caller. */
export function writeHandoff(worktreePath: string, content: string): void {
  try {
    mkdirSync(join(worktreePath, '.nest'), { recursive: true })
    writeFileSync(handoffPath(worktreePath), content)
  } catch (err) {
    console.warn('[handoff] write failed', err)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/handoff.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/handoff.ts electron/__tests__/handoff.test.ts
git commit -m "feat(handoff): .nest/handoff.md read/write helpers"
```

---

## Task 2: Pipeline logic (compose step input + next step)

**Files:**
- Create: `src/lib/worker-run.ts`
- Test: `src/lib/__tests__/worker-run.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/worker-run.test.ts
import { describe, it, expect } from 'vitest'
import { composeStepInput, nextStep } from '../worker-run'
import type { WorkerSpec } from '../../types'

const spec: WorkerSpec = {
  id: 'w', name: 'explore-then-implement', createdAt: 0, updatedAt: 0,
  steps: [
    { agent: 'opencode', model: 'cheap', instructions: 'Explore and find the bug.', role: 'explore' },
    { agent: 'claude', model: 'opus', instructions: 'Fix the bug.', role: 'implement' },
  ],
}

describe('composeStepInput', () => {
  it('non-final step appends the handoff-write instruction', () => {
    const out = composeStepInput('Explore and find the bug.', null, false)
    expect(out).toContain('Explore and find the bug.')
    expect(out).toContain('.nest/handoff.md')
  })
  it('final step prepends the handoff and omits the write instruction', () => {
    const out = composeStepInput('Fix the bug.', 'The bug is a missing await on line 42.', true)
    expect(out).toContain('missing await on line 42')
    expect(out).toContain('Fix the bug.')
    expect(out).not.toContain('.nest/handoff.md')
  })
})

describe('nextStep', () => {
  it('returns the next step when one exists', () => {
    expect(nextStep(spec, { workerId: 'w', stepIndex: 0 })).toEqual({ step: spec.steps[1], index: 1 })
  })
  it('returns null past the last step', () => {
    expect(nextStep(spec, { workerId: 'w', stepIndex: 1 })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/worker-run.test.ts`
Expected: FAIL — cannot resolve `../worker-run`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/worker-run.ts
import type { WorkerSpec, WorkerStep } from '../types'

export interface WorkerRun { workerId: string; stepIndex: number }

/** Build the initial input for a step: prepend any handoff from the prior
 *  step, include the step's own instructions, and — for non-final steps —
 *  instruct the agent to write its handoff summary when done. */
export function composeStepInput(
  instructions: string | undefined,
  handoff: string | null,
  isFinal: boolean,
): string {
  const parts: string[] = []
  if (handoff) parts.push(`Handoff from the previous step:\n\n${handoff}`)
  if (instructions) parts.push(instructions)
  if (!isFinal) parts.push('When you finish, write a concise handoff summary (what you did, what remains, key files) to .nest/handoff.md.')
  return parts.join('\n\n')
}

/** The step after the current run position, or null if the pipeline is done. */
export function nextStep(spec: WorkerSpec, run: WorkerRun): { step: WorkerStep; index: number } | null {
  const i = run.stepIndex + 1
  if (i >= spec.steps.length) return null
  return { step: spec.steps[i], index: i }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/worker-run.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/worker-run.ts src/lib/__tests__/worker-run.test.ts
git commit -m "feat(handoff): pure pipeline logic (composeStepInput, nextStep)"
```

---

## Task 3: Handoff IPC + preload

**Files:**
- Modify: `electron/main.ts` (near the worktree handlers), `electron/preload.ts`

- [ ] **Step 1: Add IPC handlers**

Import in `main.ts`: `import { readHandoff, writeHandoff } from './integrations/handoff'`. Near the worktree/session IPC (around `startWorkOnWorktree`, `main.ts:2628`):
```ts
ipcMain.handle('handoff:read', (_e, worktreePath: string) => readHandoff(worktreePath))
ipcMain.handle('handoff:write', (_e, worktreePath: string, content: string) => writeHandoff(worktreePath, content))
```

- [ ] **Step 2: Expose in preload**

```ts
contextBridge.exposeInMainWorld('handoff', {
  read: (worktreePath: string) => ipcRenderer.invoke('handoff:read', worktreePath),
  write: (worktreePath: string, content: string) => ipcRenderer.invoke('handoff:write', worktreePath, content),
})
```
Add the `handoff` bridge type to the global `Window` in `src/types.ts`:
```ts
handoff: {
  read: (worktreePath: string) => Promise<string | null>
  write: (worktreePath: string, content: string) => Promise<void>
}
```

- [ ] **Step 3: Typecheck**

Run: the project's typecheck scripts (`tsc --noEmit` for renderer + electron).
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts electron/preload.ts src/types.ts
git commit -m "feat(handoff): read/write IPC bridge"
```

---

## Task 4: Multi-step worker editor

**Files:**
- Modify: `src/components/AutomationsView.tsx` (the worker create/edit form from Capa 1 Task 6)

- [ ] **Step 1: Turn the single-step form into a steps array**

Replace the single `{wAgent, wModel, wInstructions}` state with `const [wSteps, setWSteps] = useState<WorkerStep[]>([{ agent: 'claude' }])`. Render each step as a row (agent `<select>` + model `<select>` when `AI_CONFIG[step.agent].models?.length` + instructions textarea + role input), with "+ Add step" and "× remove" (min 1 step). Save payload: `{ name: wName, steps: wSteps }`.

- [ ] **Step 2: Show the pipeline in the worker list**

The list row already renders `w.steps.map(...).join(' → ')` (Capa 1 Task 6) — a 2-step worker now reads e.g. `opencode:cheap → claude:opus`, which visually communicates the pipeline. No change needed beyond confirming it.

- [ ] **Step 3: Test multi-step save**

Extend `AutomationsView-workers.test.tsx`: add a step, assert `window.workerSpecs.save` is called with `steps.length === 2` and the second step's agent/model.

Run: `npx vitest run src/__tests__/components/AutomationsView-workers.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/AutomationsView.tsx src/__tests__/components/AutomationsView-workers.test.tsx
git commit -m "feat(handoff): multi-step (pipeline) worker editor"
```

---

## Task 5: "Hand off →" advance action

**Files:**
- Modify: `src/App.tsx` (track `activeWorkerRun` per worktree; advance handler)
- Modify: `src/components/TerminalPane.tsx` (render the button)

**Context:** When a worktree is opened with a multi-step worker (Capa 1 Task 7 recorded the worker on `setAddingPane`), remember `activeWorkerRun[worktreePath] = { workerId, stepIndex: 0 }`. The "Hand off →" button appears while a next step exists; clicking reads `.nest/handoff.md` and opens the next step's pane seeded with `composeStepInput`.

- [ ] **Step 1: Track the active run**

In `App.tsx` add `const [activeWorkerRun, setActiveWorkerRun] = useState<Record<string, WorkerRun>>({})`. When opening a worktree with a worker (Capa 1 Task 7's `onOpenWorktree` path), also `setActiveWorkerRun((m) => ({ ...m, [path]: { workerId: worker.id, stepIndex: 0 } }))`. Load worker-specs into `App` state (`window.workerSpecs.list()`), so the spec is resolvable by id.

- [ ] **Step 2: Advance handler**

```ts
const advanceHandoff = useCallback(async (worktreePath: string) => {
  const run = activeWorkerRun[worktreePath]
  const spec = workerSpecs.find((s) => s.id === run?.workerId)
  if (!run || !spec) return
  const next = nextStep(spec, run)
  if (!next) return
  const handoff = await window.handoff.read(worktreePath)
  const isFinal = next.index === spec.steps.length - 1
  const initialInput = composeStepInput(next.step.instructions, handoff, isFinal)
  setAddingPane({ worktreePath, initialInput, presetAgent: next.step.agent, presetModel: next.step.model })
  setActiveWorkerRun((m) => ({ ...m, [worktreePath]: { ...run, stepIndex: next.index } }))
}, [activeWorkerRun, workerSpecs])
```
(Reuses `setAddingPane`/`presetAgent`/`presetModel` from Capa 1 Task 7 — the next step launches with its own agent + model flag, seeded with the handoff.)

- [ ] **Step 3: Render the button on the pane**

Pass `hasNextStep` + `onHandoff` to the active pane's header. Show "Hand off →" only when `nextStep(spec, run)` is non-null for that pane's `repoPath`. On click → `advanceHandoff(pane.repoPath)`.

- [ ] **Step 4: Manual verification (the full cooperative flow)**

1. Create a 2-step worker: `{opencode, cheap-model, "Explore and find the bug"}` → `{claude, opus, "Fix the bug"}`.
2. Open a board task with it. Confirm the opencode pane launches with the cheap model and instructions ending "…write your handoff summary to .nest/handoff.md".
3. Let it write `.nest/handoff.md` (or write one manually via devtools `window.handoff.write`).
4. Click "Hand off →". Confirm a Claude pane opens in the SAME worktree, launched as `claude --model opus`, seeded with the handoff summary + "Fix the bug", and no "Hand off" button remains (final step).
Expected: two agents cooperated on one worktree, context passed through the file, strong model started from a lean summary.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/TerminalPane.tsx
git commit -m "feat(handoff): Hand off -> advances a worker pipeline to the next agent"
```

---

## Task 6 (optional fast-follow): auto-advance watcher

**Files:**
- Modify: `electron/main.ts` (watch `.nest/handoff.md`), `electron/preload.ts`, `src/App.tsx`

- [ ] **Step 1:** Add an opt-in `fs.watch` on `<worktree>/.nest/handoff.md` (started when a multi-step worker opens; stopped on advance/close) that pushes a `handoff:changed` event to the renderer. On receipt, surface a non-blocking "Step A wrote a handoff — Hand off now?" prompt rather than auto-launching (keeps the human in control; the manual button remains the contract). Debounce writes. Guard against watching a non-existent dir.
- [ ] **Step 2:** Manual verify: writing `.nest/handoff.md` from step A surfaces the prompt within ~1s.
- [ ] **Step 3:** Commit `feat(handoff): optional watcher surfaces "ready to hand off"`.

> If time-boxed, SKIP this task — the manual "Hand off →" button (Task 5) is the shipping contract. Log the skip so it's not mistaken for done.

---

## Self-Review

- **Spec coverage (§6c / G4):** sequential handoff → Tasks 1-5. Same-worktree, no-conflict → Task 5 opens the next pane on the same `worktreePath`. Reuse of `initialInput` seeding → Task 5 uses `setAddingPane` (Capa 1). Handoff via `.nest/handoff.md` → Tasks 1/3. Explicit advancement (N3: no agent-done inference) → Task 5 button; watcher is opt-in (Task 6) and still only *prompts*.
- **Placeholder scan:** none — every code step has full code; the watcher (Task 6) is explicitly optional with a skip-log instruction, not a placeholder.
- **Type consistency:** `WorkerRun { workerId, stepIndex }` identical in `worker-run.ts` (Task 2) and `App.tsx` (Task 5). `composeStepInput(instructions, handoff, isFinal)` and `nextStep(spec, run)` signatures consistent Task 2 ↔ Task 5. `presetAgent`/`presetModel` reused from Capa 1 Task 7 (dependency noted in header).

---

## Execution Handoff

**Plans complete.** Two plans, execute in order: (1) `2026-08-11-worker-spec-model-per-task.md` then (2) this one.

Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.

**2. Inline Execution** — execute tasks in this session with checkpoints. REQUIRED SUB-SKILL: `superpowers:executing-plans`.
