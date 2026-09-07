# Worker-Spec & Model-per-Task (Capa 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pin `{agent, model, instructions}` to a reusable named worker-spec and have the chosen model actually reach the launched CLI (`--model <id>`), managed inside the existing Integrations hub.

**Architecture:** A new validated JSON store (`worker-spec-store.ts`, same atomic/versioned pattern as `scheduler.ts`) holds `WorkerSpec`s. A pure `appendModelFlag` helper composes the launch command from a per-agent `modelFlag` declared on `AI_CONFIG`. The worker library is edited in `AutomationsView` and applied from the board-open picker; the manual pane-launch path really spawns a CLI today, so this delivers the token-cost win immediately. Automations gain `workerId`/`model`/`effort` fields, threaded into the (still stubbed) headless run for later.

**Tech Stack:** Electron + React + TypeScript, vitest, node-pty. Persistence under `<ravenHome>/.raven-nest/`.

**Spec:** `docs/superpowers/specs/2026-08-11-worker-spec-model-per-task-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `electron/integrations/worker-spec-store.ts` **(new)** | `WorkerSpec`/`WorkerStep` types, load/save (atomic+versioned), validate, id, `WorkerSpecStore` class |
| `electron/__tests__/worker-spec-store.test.ts` **(new)** | Unit tests for the store |
| `src/lib/launch-cmd.ts` **(new)** | Pure `appendModelFlag(baseCmd, modelFlag, model)` |
| `src/lib/__tests__/launch-cmd.test.ts` **(new)** | Unit tests for the composer |
| `src/types.ts` | `AI_CONFIG` gains `modelFlag?`/`models?`; add read-only `WorkerSpec`/`WorkerStep` mirror + `WorkerSpecsBridge`; `Automation`/`AutomationInput` gain `workerId?`/`model?`/`effort?` |
| `electron/integrations/scheduler.ts` | `Automation` gains `workerId?`/`model?`/`effort?`; `toAutomation` reads them |
| `electron/main.ts` | register `WorkerSpecStore`; `workerspec:*` IPC; thread model/effort into `runAutomationStub` |
| `electron/preload.ts` | expose `window.workerSpecs` |
| `src/components/AutomationsView.tsx` | worker-spec library section (list + create/edit); automation form gains model dropdown |
| `src/components/WorktreePicker.tsx` | "Run with worker" dropdown → resolves cmd with model flag |
| `src/components/NewPaneDialog.tsx` | apply `appendModelFlag` when resolving `cmd` |

---

## Task 1: Worker-spec store (types + persistence)

**Files:**
- Create: `electron/integrations/worker-spec-store.ts`
- Test: `electron/__tests__/worker-spec-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// electron/__tests__/worker-spec-store.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  loadWorkerSpecs, saveWorkerSpecs, newWorkerSpecId, type WorkerSpec,
} from '../integrations/worker-spec-store'

const tmpDirs: string[] = []
function tmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'worker-spec-test-'))
  tmpDirs.push(dir)
  return join(dir, 'sub', 'worker-specs.json') // sub/ missing: exercises mkdir -p
}
function makeSpec(over: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    id: 'w1', name: 'triage-bug',
    steps: [{ agent: 'codex', model: 'haiku', instructions: 'Triage this bug.' }],
    createdAt: 0, updatedAt: 0, ...over,
  }
}
afterEach(() => { while (tmpDirs.length) { try { rmSync(tmpDirs.pop()!, { recursive: true, force: true }) } catch { /* ignore */ } } })

describe('worker-spec-store persistence', () => {
  it('missing file → empty list', () => {
    expect(loadWorkerSpecs(join(tmpdir(), 'nope', 'x.json'))).toEqual([])
  })
  it('round-trips through atomic save + versioned wrapper', () => {
    const f = tmpFile()
    saveWorkerSpecs(f, [makeSpec()])
    expect(JSON.parse(readFileSync(f, 'utf8')).version).toBe(1)
    expect(loadWorkerSpecs(f)).toEqual([makeSpec()])
  })
  it('drops an invalid record but keeps valid ones', () => {
    const f = tmpFile()
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, JSON.stringify({ version: 1, workers: [makeSpec(), { id: 5 }, { name: 'no-id' }] }))
    expect(loadWorkerSpecs(f)).toEqual([makeSpec()])
  })
  it('drops a spec whose steps are empty or malformed', () => {
    const f = tmpFile()
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, JSON.stringify({ version: 1, workers: [
      makeSpec({ id: 'ok' }),
      makeSpec({ id: 'nosteps', steps: [] }),
      makeSpec({ id: 'badstep', steps: [{ model: 'x' } as never] }), // no agent
    ] }))
    expect(loadWorkerSpecs(f).map((w) => w.id)).toEqual(['ok'])
  })
  it('newWorkerSpecId returns a non-empty hex string', () => {
    expect(newWorkerSpecId()).toMatch(/^[0-9a-f]+$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/worker-spec-store.test.ts`
Expected: FAIL — cannot resolve `../integrations/worker-spec-store`.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/integrations/worker-spec-store.ts
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { dirname } from 'path'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { ravenHome } from '../raven-home'

export type WorkerAgent = 'claude' | 'gemini' | 'codex' | 'copilot' | 'opencode' | 'custom'

export interface WorkerStep {
  agent: WorkerAgent
  customCliId?: string
  model?: string
  effort?: 'low' | 'medium' | 'high'
  instructions?: string
  role?: string
}

export interface WorkerSpec {
  id: string
  name: string
  description?: string
  steps: WorkerStep[]
  createdAt: number
  updatedAt: number
}

const VALID_AGENTS: WorkerAgent[] = ['claude', 'gemini', 'codex', 'copilot', 'opencode', 'custom']

function toStep(x: unknown): WorkerStep | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  if (typeof r.agent !== 'string' || !VALID_AGENTS.includes(r.agent as WorkerAgent)) return null
  const out: WorkerStep = { agent: r.agent as WorkerAgent }
  if (typeof r.customCliId === 'string') out.customCliId = r.customCliId
  if (typeof r.model === 'string') out.model = r.model
  if (r.effort === 'low' || r.effort === 'medium' || r.effort === 'high') out.effort = r.effort
  if (typeof r.instructions === 'string') out.instructions = r.instructions
  if (typeof r.role === 'string') out.role = r.role
  return out
}

function toWorkerSpec(x: unknown): WorkerSpec | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || !Array.isArray(r.steps)) return null
  const steps = r.steps.map(toStep).filter((s): s is WorkerStep => s !== null)
  if (steps.length === 0) return null
  const out: WorkerSpec = {
    id: r.id, name: r.name, steps,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  }
  if (typeof r.description === 'string') out.description = r.description
  return out
}

export function loadWorkerSpecs(filePath: string): WorkerSpec[] {
  let raw: string
  try { raw = readFileSync(filePath, 'utf8') } catch { return [] }
  try {
    const data = JSON.parse(raw) as { workers?: unknown }
    const list = Array.isArray(data.workers) ? data.workers : []
    const out: WorkerSpec[] = []
    for (const item of list) { const w = toWorkerSpec(item); if (w) out.push(w) }
    return out
  } catch (err) {
    console.warn('[worker-spec] worker-specs.json unreadable, using empty list', err)
    return []
  }
}

export function saveWorkerSpecs(filePath: string, workers: WorkerSpec[]): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, workers }, null, 2))
    renameSync(tmp, filePath)
  } catch (err) {
    console.warn('[worker-spec] worker-specs.json write failed', err)
  }
}

export function newWorkerSpecId(): string {
  return randomBytes(8).toString('hex')
}

export function defaultWorkerSpecPath(): string {
  return join(ravenHome(), '.raven-nest', 'worker-specs.json')
}

export class WorkerSpecStore {
  constructor(private filePath: string = defaultWorkerSpecPath()) {}
  list(): WorkerSpec[] { return loadWorkerSpecs(this.filePath) }
  save(spec: WorkerSpec): WorkerSpec {
    const specs = this.list()
    const idx = specs.findIndex((s) => s.id === spec.id)
    if (idx >= 0) specs[idx] = spec; else specs.push(spec)
    saveWorkerSpecs(this.filePath, specs)
    return spec
  }
  delete(id: string): boolean {
    const specs = this.list()
    const next = specs.filter((s) => s.id !== id)
    saveWorkerSpecs(this.filePath, next)
    return next.length !== specs.length
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/worker-spec-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/worker-spec-store.ts electron/__tests__/worker-spec-store.test.ts
git commit -m "feat(worker-spec): validated atomic store for worker-specs"
```

---

## Task 2: Model-flag composer (pure)

**Files:**
- Create: `src/lib/launch-cmd.ts`
- Test: `src/lib/__tests__/launch-cmd.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/launch-cmd.test.ts
import { describe, it, expect } from 'vitest'
import { appendModelFlag } from '../launch-cmd'

describe('appendModelFlag', () => {
  it('appends "<flag> <model>" when both flag and model are present', () => {
    expect(appendModelFlag('claude', '--model', 'opus')).toBe('claude --model opus')
    expect(appendModelFlag('gemini', '-m', 'gemini-2.5-pro')).toBe('gemini -m gemini-2.5-pro')
  })
  it('returns base unchanged when the agent has no model flag', () => {
    expect(appendModelFlag('gh copilot', undefined, 'anything')).toBe('gh copilot')
  })
  it('returns base unchanged when no model is chosen', () => {
    expect(appendModelFlag('claude', '--model', undefined)).toBe('claude')
    expect(appendModelFlag('claude', '--model', '')).toBe('claude')
  })
  it('never touches an empty base command (plain terminal/browser)', () => {
    expect(appendModelFlag('', '--model', 'opus')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/launch-cmd.test.ts`
Expected: FAIL — cannot resolve `../launch-cmd`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/launch-cmd.ts
/** Compose a launch command with an optional per-agent model flag.
 *  Pure + total: an empty base (plain terminal/browser) is never modified,
 *  and a missing flag or model degrades to the base command (no-op) rather
 *  than emitting a broken command. */
export function appendModelFlag(
  baseCmd: string,
  modelFlag: string | undefined,
  model: string | undefined,
): string {
  if (!baseCmd) return baseCmd
  if (!modelFlag || !model) return baseCmd
  return `${baseCmd} ${modelFlag} ${model}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/launch-cmd.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/launch-cmd.ts src/lib/__tests__/launch-cmd.test.ts
git commit -m "feat(worker-spec): pure appendModelFlag command composer"
```

---

## Task 3: Declare per-agent model capability on `AI_CONFIG` + verify flags

**Files:**
- Modify: `src/types.ts:453-462` (`AI_CONFIG`)

- [ ] **Step 1: Verify the real model-flag syntax per CLI** (OQ1 — do NOT guess)

Run each and read the flag name/model ids:
```bash
claude --help | grep -i model
codex --help | grep -i model
gemini --help | grep -iE 'model|-m'
opencode --help | grep -i model
gh copilot --help | grep -i model   # expected: no model flag
```
Record the exact flag string for each (e.g. `--model`). If a CLI has no model flag, leave `modelFlag` undefined for it. Use context7 (`mcp__plugin_context7_context7__query-docs`) for the current model ids if `--help` doesn't list them.

- [ ] **Step 2: Extend the `AI_CONFIG` value type and fill verified values**

Edit `src/types.ts:453` — add two optional fields to the record's value type, then fill only the verified ones:
```ts
export const AI_CONFIG: Record<AIType, {
  label: string; color: string; bg: string; cmd: string; noAccount?: boolean
  modelFlag?: string      // CLI flag that selects a model, e.g. '--model'. Absent = no model selection.
  models?: string[]       // known selectable model ids/aliases for the picker
}> = {
  claude:   { label: 'Claude',   color: '#E07B54', bg: '#2a1a14', cmd: 'claude',     modelFlag: '--model', models: ['opus', 'sonnet', 'haiku'] },
  gemini:   { label: 'Gemini',   color: '#4F9EFF', bg: '#0d1f35', cmd: 'gemini',     modelFlag: '<VERIFIED_FLAG>', models: [/* verified ids */] },
  codex:    { label: 'Codex',    color: '#aaaaaa', bg: '#1c1c1c', cmd: 'codex',      modelFlag: '<VERIFIED_FLAG>', models: [/* verified ids */] },
  copilot:  { label: 'Copilot',  color: '#7C5CFC', bg: '#150d2e', cmd: 'gh copilot' /* no modelFlag */ },
  opencode: { label: 'OpenCode', color: '#FFFFFF', bg: '#111111', cmd: 'opencode', noAccount: true, modelFlag: '<VERIFIED_FLAG>', models: [/* verified ids */] },
  terminal: { label: 'Terminal', color: '#888888', bg: '#1a1a1a', cmd: '',           noAccount: true },
  custom:   { label: 'Custom',   color: '#888888', bg: '#1a1a1a', cmd: '',           noAccount: true },
  browser:  { label: 'Browser',  color: '#0066FF', bg: '#0a1428', cmd: '',           noAccount: true },
}
```
Replace every `<VERIFIED_FLAG>` and model list with the Step 1 findings. Claude's `--model opus|sonnet|haiku` aliases are known-good; keep them. Leave `modelFlag` undefined for any CLI Step 1 shows has none.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json` (or the project's typecheck script)
Expected: no errors from `types.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(worker-spec): declare per-agent model flag + model list on AI_CONFIG"
```

---

## Task 4: Apply the model flag when launching a pane

**Files:**
- Modify: `src/components/NewPaneDialog.tsx:121` (and the `onConfirm` cmd it passes)

**Context:** `NewPaneDialog` resolves `const cmd = AI_CONFIG[selectedAI].cmd` at line 121 and passes it into `onConfirm(...)`. We add optional model state and compose the cmd through `appendModelFlag`. The manual grid still works with no model chosen (no-op).

- [ ] **Step 1: Import the composer and add model state**

At the top of `NewPaneDialog.tsx`, add:
```ts
import { appendModelFlag } from '../lib/launch-cmd'
```
Near the other `useState` hooks:
```ts
const [model, setModel] = useState<string>('')  // '' = agent default
```

- [ ] **Step 2: Compose cmd through the flag at the resolution point**

Replace `const cmd = AI_CONFIG[selectedAI].cmd` (`:121`) with:
```ts
const agentCfg = AI_CONFIG[selectedAI]
const cmd = appendModelFlag(agentCfg.cmd, agentCfg.modelFlag, model)
```
Update the other `onConfirm(..., AI_CONFIG[selectedAI].cmd)` sites (`:170`, `:210`, `:552`) to pass `appendModelFlag(AI_CONFIG[selectedAI].cmd, AI_CONFIG[selectedAI].modelFlag, model)` instead of the bare `.cmd`. (The `noAccount` site `:155` uses `cfg.cmd` — pass `appendModelFlag(cfg.cmd, cfg.modelFlag, model)`.)

- [ ] **Step 3: Render a model dropdown for agents that support it**

In the AI-selected step, after the agent is chosen, render (only when `AI_CONFIG[selectedAI].models` is non-empty):
```tsx
{AI_CONFIG[selectedAI]?.models?.length ? (
  <select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)} className="npd-model-select">
    <option value="">Default model</option>
    {AI_CONFIG[selectedAI]!.models!.map((m) => <option key={m} value={m}>{m}</option>)}
  </select>
) : null}
```

- [ ] **Step 4: Manual verification (real CLI spawn)**

Run the app (`npm run dev`), open a new Claude pane, pick model `haiku`. Confirm the terminal launches `claude --model haiku` (visible in the shell line). Then open a Copilot pane — confirm NO model dropdown appears and the command is unchanged.
Expected: model flag present for Claude, absent for Copilot.

- [ ] **Step 5: Commit**

```bash
git add src/components/NewPaneDialog.tsx
git commit -m "feat(worker-spec): apply model flag on manual pane launch"
```

---

## Task 5: Worker-spec IPC + preload + main registration

**Files:**
- Modify: `electron/main.ts:166` (register), `electron/main.ts:~890` (handlers)
- Modify: `electron/preload.ts:31` (expose `window.workerSpecs`)
- Modify: `src/types.ts` (read-only `WorkerSpec` mirror + `WorkerSpecsBridge`)

- [ ] **Step 1: Add the renderer mirror + bridge type**

In `src/types.ts`, near the `Automation` mirror (~`:223`), add (mirror of `worker-spec-store.ts`, since `src/` never imports from `electron/`):
```ts
export interface WorkerStep {
  agent: AIType
  customCliId?: string
  model?: string
  effort?: 'low' | 'medium' | 'high'
  instructions?: string
  role?: string
}
export interface WorkerSpec {
  id: string
  name: string
  description?: string
  steps: WorkerStep[]
  createdAt: number
  updatedAt: number
}
export interface WorkerSpecInput {
  name: string
  description?: string
  steps: WorkerStep[]
}
export interface WorkerSpecsBridge {
  list: () => Promise<WorkerSpec[]>
  save: (input: WorkerSpecInput & { id?: string }) => Promise<WorkerSpec>
  delete: (id: string) => Promise<boolean>
}
```
Add `workerSpecs: WorkerSpecsBridge` to the global `Window` interface where the other bridges (`automations`, `customCLIs`) are declared.

- [ ] **Step 2: Register the store + IPC handlers in main**

Near `const customCLIStore = new CustomCLIStore()` (`main.ts:166`):
```ts
const workerSpecStore = new WorkerSpecStore()
```
Add the import at the top of `main.ts` (with the other `electron/integrations` imports):
```ts
import { WorkerSpecStore, newWorkerSpecId, type WorkerSpec } from './integrations/worker-spec-store'
```
Near the `customcli:*` handlers (`main.ts:~890`):
```ts
ipcMain.handle('workerspec:list', () => workerSpecStore.list())
ipcMain.handle('workerspec:save', (_e, input: { id?: string; name: string; description?: string; steps: WorkerSpec['steps'] }) => {
  const now = Date.now()
  const existing = input.id ? workerSpecStore.list().find((s) => s.id === input.id) : undefined
  const spec: WorkerSpec = {
    id: input.id ?? newWorkerSpecId(),
    name: input.name,
    description: input.description,
    steps: input.steps,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  return workerSpecStore.save(spec)
})
ipcMain.handle('workerspec:delete', (_e, id: string) => workerSpecStore.delete(id))
```

- [ ] **Step 3: Expose in preload**

Near the `customCLIs` block (`preload.ts:31`):
```ts
contextBridge.exposeInMainWorld('workerSpecs', {
  list: () => ipcRenderer.invoke('workerspec:list'),
  save: (input: unknown) => ipcRenderer.invoke('workerspec:save', input),
  delete: (id: string) => ipcRenderer.invoke('workerspec:delete', id),
})
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.json` and `npx tsc --noEmit -p tsconfig.electron.json` (use the project's actual typecheck scripts if named differently).
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts src/types.ts
git commit -m "feat(worker-spec): IPC + preload bridge for worker-spec CRUD"
```

---

## Task 6: Worker-spec library UI in the hub (Automations tab)

**Files:**
- Modify: `src/components/AutomationsView.tsx`

**Context:** `AutomationsView` already lists/creates scheduled agents. Add a "Workers" section above the schedule list: a list of worker-specs with a create/edit form. Reuse the existing `.auto-*` classes for visual consistency.

- [ ] **Step 1: Load worker-specs alongside automations**

Add state + load in `AutomationsView`:
```ts
const [workers, setWorkers] = useState<WorkerSpec[]>([])
const refreshWorkers = () => { void window.workerSpecs?.list?.().then(setWorkers) }
useEffect(() => { refreshWorkers() }, [])
```
Import: `import type { WorkerSpec } from '../types'`.

- [ ] **Step 2: Render the worker list + a minimal create form**

Add a section above the automations list. Minimal single-step create (multi-step lands in the handoff plan):
```tsx
<div className="auto-head">
  <div><h2 className="auto-title">Workers</h2>
    <p className="auto-lead">Reusable task types: pick the agent + model once, run it anywhere.</p></div>
  <button className="integration-btn primary" onClick={() => setShowWorkerForm((v) => !v)}>+ New worker</button>
</div>
{/* form: name input; agent <select> from AI_CONFIG (modelFlag ? show model <select>); instructions textarea */}
{workers.map((w) => (
  <div key={w.id} className="auto-row">
    <div className="auto-row-main">
      <span className="auto-row-name">{w.name}</span>
      <span className="auto-row-sched">{w.steps.map((s) => s.model ? `${s.agent}:${s.model}` : s.agent).join(' → ')}</span>
    </div>
    <div className="auto-row-actions">
      <button className="auto-delete" aria-label={`Delete ${w.name}`}
        onClick={() => void window.workerSpecs.delete(w.id).then(refreshWorkers)}>×</button>
    </div>
  </div>
))}
```
Create handler:
```ts
const createWorker = async () => {
  await window.workerSpecs.save({
    name: wName.trim(),
    steps: [{ agent: wAgent, model: wModel || undefined, instructions: wInstructions.trim() || undefined }],
  })
  refreshWorkers(); setShowWorkerForm(false)
}
```
(`wName`/`wAgent`/`wModel`/`wInstructions`/`showWorkerForm` are new `useState`s. The agent `<select>` iterates `Object.entries(AI_CONFIG)` filtering `noAccount` shells; the model `<select>` shows only when `AI_CONFIG[wAgent].models?.length`.)

- [ ] **Step 3: Test the CRUD wiring**

Add `src/__tests__/components/AutomationsView-workers.test.tsx` mirroring the existing component-test pattern (`vi.stubGlobal('window', { workerSpecs: { list: vi.fn().mockResolvedValue([...]), save: vi.fn(), delete: vi.fn() }, automations: {...} })`), assert a worker row renders and delete calls `window.workerSpecs.delete`.

Run: `npx vitest run src/__tests__/components/AutomationsView-workers.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/AutomationsView.tsx src/__tests__/components/AutomationsView-workers.test.tsx
git commit -m "feat(worker-spec): worker library UI in the Automations tab"
```

---

## Task 7: "Run with worker" from the board-open flow

**Files:**
- Modify: `src/components/WorktreePicker.tsx`

**Context:** the board-open flow opens a worktree via `onOpenWorktree(path, initialInput)`. Add a worker dropdown so opening a task launches it with the worker's agent+model+instructions. The chosen worker's `steps[0]` drives the first pane; `instructions` becomes `initialInput`.

- [ ] **Step 1: Load workers + add a selector**

In `WorktreePicker`, load `window.workerSpecs.list()` into state and render a `<select>` ("Run with worker: [none | <names>]"). On selecting a worker, remember `steps[0]`.

- [ ] **Step 2: Pass the worker's agent+model+instructions into the open**

When opening the worktree with a worker chosen, the parent (`App`) must launch the first pane with the worker's agent and the model-composed cmd. Extend the `onOpenWorktree` contract to accept an optional `worker?: WorkerStep`:
```ts
onOpenWorktree?: (worktreePath: string, initialInput?: string, worker?: WorkerStep) => void
```
In `App.tsx` where `onOpenWorktree` is wired (`:1305,1313`), set `setAddingPane({ worktreePath: path, initialInput: worker?.instructions ?? initialInput, presetAgent: worker?.agent, presetModel: worker?.model })`, and in `addPane`/`NewPaneDialog` preselect `presetAgent`/`presetModel` so the resolved `cmd` carries the flag (reuses Task 4). If no worker chosen, behavior is unchanged.

- [ ] **Step 3: Manual verification**

Run the app, create a worker `{agent: claude, model: haiku, instructions: "Fix the failing test"}`, open a board task "Run with worker: that worker". Confirm a Claude pane launches as `claude --model haiku` and the instruction is keystroked in once.
Expected: correct agent, model flag, and seeded instruction.

- [ ] **Step 4: Commit**

```bash
git add src/components/WorktreePicker.tsx src/App.tsx
git commit -m "feat(worker-spec): run a board task with a chosen worker (agent+model+instructions)"
```

---

## Task 8: Automations carry model/effort (plumbed to the stub)

**Files:**
- Modify: `electron/integrations/scheduler.ts:14` (`Automation`) + `:219` (`toAutomation`)
- Modify: `src/types.ts:223` (mirror) + `src/components/AutomationsView.tsx` (form)
- Modify: `electron/main.ts:2403` (`runAutomationStub`)

- [ ] **Step 1: Extend the `Automation` type + validator (write failing test)**

Add to `electron/__tests__/scheduler.test.ts`:
```ts
it('toAutomation preserves workerId/model/effort when present', () => {
  const f = tmpFile()
  saveAutomations(f, [makeAutomation({ workerId: 'w1', model: 'haiku', effort: 'low' })])
  const [a] = loadAutomations(f)
  expect(a.workerId).toBe('w1'); expect(a.model).toBe('haiku'); expect(a.effort).toBe('low')
})
```
Run: `npx vitest run electron/__tests__/scheduler.test.ts` → FAIL (fields dropped).

- [ ] **Step 2: Implement the fields**

In `scheduler.ts:14` add to `Automation`: `workerId?: string`, `model?: string`, `effort?: 'low' | 'medium' | 'high'`. In `toAutomation` (`:236`, after the `provider` line) add:
```ts
if (typeof r.workerId === 'string') out.workerId = r.workerId
if (typeof r.model === 'string') out.model = r.model
if (r.effort === 'low' || r.effort === 'medium' || r.effort === 'high') out.effort = r.effort
```
Mirror the three fields on `Automation`/`AutomationInput` in `src/types.ts:223` and `:246`.

Run: `npx vitest run electron/__tests__/scheduler.test.ts` → PASS.

- [ ] **Step 3: Thread into the stub (visible for when headless lands)**

In `runAutomationStub` (`main.ts:2403`), include the resolved model in the warn + summary so it's observable:
```ts
const model = automation.model ?? (automation.workerId ? workerSpecStore.list().find((w) => w.id === automation.workerId)?.steps[0]?.model : undefined)
console.warn('[automations] headless run STUBBED — not spawning a CLI', automation.id, automation.name, 'model:', model ?? 'default')
return { ok: true, summary: `Stubbed run — headless execution not wired yet (would use model: ${model ?? 'default'})` }
```

- [ ] **Step 4: Add the model dropdown to the automation form**

In `AutomationsView.tsx`, next to the existing Provider `<select>` (`:176`), add a model `<select>` populated from `AI_CONFIG[provider].models` (shown only when non-empty), and include `model` in the `window.automations.create({...})` payload (`:83`).

- [ ] **Step 5: Typecheck + full suite**

Run: `npx vitest run` and the typecheck scripts.
Expected: all green (existing baseline + new tests).

- [ ] **Step 6: Commit**

```bash
git add electron/integrations/scheduler.ts electron/main.ts src/types.ts src/components/AutomationsView.tsx electron/__tests__/scheduler.test.ts
git commit -m "feat(worker-spec): automations carry model/effort, threaded into the run seam"
```

---

## Self-Review

- **Spec coverage:** G1 → Task 1/5/6. G2 → Task 2/3/4. G3 → Task 6/7 (+ Task 8 for automations). Automation extension (spec §3) → Task 8. Model-flag-per-CLI (spec §4) → Task 3 (with verify step for OQ1). N4 respected — Task 8 only plumbs the stub, no live spawn. Capa 2 (G4) is out of this plan → the cooperative-handoff plan.
- **Placeholder scan:** `<VERIFIED_FLAG>`/`<verified ids>` in Task 3 are *deliberate* — Step 1 is a real verification action that fills them; they must not survive into committed code (Step 2 replaces them). No other placeholders.
- **Type consistency:** `WorkerSpec`/`WorkerStep` identical in `worker-spec-store.ts` (Task 1) and the `src/types.ts` mirror (Task 5). `appendModelFlag(base, modelFlag, model)` signature consistent across Task 2/4. `modelFlag`/`models` added to `AI_CONFIG` in Task 3, consumed in Task 4/6/8.

---

## Execution Handoff — see end of the cooperative-handoff plan (execute Capa 1 first).
