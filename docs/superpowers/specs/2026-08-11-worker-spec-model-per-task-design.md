# Worker-Spec & Model-per-Task — Design Spec

**Date:** 2026-08-11
**Branch:** `feat/integrations`
**Status:** Design (approved direction: Capa 1 + Capa 2/B1; Gero delegated advancing through the plan)

---

## 1. Motivation

Two real problems drive this:

1. **Token cost in long-lived terminals.** An agentic loop re-bills its whole accumulated context every turn, so a terminal running for hours (especially on Opus) burns tokens fast and hits rate limits. Today Nest delegates model choice entirely to each CLI — **Nest never sees or sets the model**, so it can't route cheap tasks to a cheap model.
2. **No reusable notion of "what runs a task."** Every teammate re-picks a CLI and re-configures per pane. There is no documented, reusable mapping of *task type → which agent + which model + which instructions*. Knowledge lives in each person's head, not in a shared asset.

The industry framing (context/graph engineering; "the model supplies intelligence, the harness supplies the company") and the competitor **Orca** both point at the same primitive: **decouple the task from the agent/model, and bind `{agent, model, effort, instructions}` at launch time.** Orca does this via `worker-start --agent codex --model <id> --effort high`. We borrow that primitive — it is the single most valuable thing to take from Orca — and land it inside Nest's existing hub.

**Differentiator (Capa 2):** Orca runs agents that **compete** (N isolated worktrees, race, keep the winner, discard the rest). We add agents that **cooperate** — two models on the *same* task sharing context (e.g. a cheap model explores and summarizes, an expensive model implements from that lean summary). That is a different axis, not a copy, and it also directly attacks the token-cost problem.

## 2. Goals / Non-Goals

### Goals (v1)
- **G1** — A **worker-spec**: a reusable, named, persisted config `{ agents[], model, effort, instructions }` describing how a *type of task* is run.
- **G2** — The missing primitive: **actually pass a model to the launched CLI** (`--model <id>`), per-agent, so choosing a worker-spec changes the model that runs.
- **G3** — Worker-specs are **documented/edited and applied inside the existing Integrations hub** — an adaptation of the current tabs (Automations + the board-open flow), **not a separate panel**.
- **G4 (Capa 2 / B1)** — **Sequential cooperative handoff**: a worker-spec may list an ordered pipeline of steps (agent+model each); agent A writes `.nest/handoff.md`, agent B is launched in the same worktree seeded with that handoff as its initial input. Cooperation, not race.

### Non-Goals (explicitly deferred)
- **N1** — Live/concurrent cooperation (shared blackboard, realtime agent↔agent channel) — that is Capa 2 options B2/B3, a later spec.
- **N2** — Fan-out at scale (one issue-list → N parallel worktrees) — Capa 3 / Epic D, a later spec.
- **N3** — Orca's full supervised-coordination DAG (`worker_done`/escalation/ask-reply/decision-gates, robust agent-done detection). We do **not** rebuild this. Handoff advancement in v1 is explicit/file-sentinel, not inferred.
- **N4** — Live headless automation execution. The automations headless run is **stubbed today** (`runAutomationStub`, `electron/main.ts:2403`). v1 makes the automation model *carry* model+effort and threads them into the run seam, but does **not** wire the actual headless CLI spawn. The guaranteed-working model-per-task path in v1 is the **manual pane launch + board-open** path, which really spawns CLIs today.

## 3. Data Model

New type (source of truth in `electron/`, mirrored read-only in `src/types.ts`, following the existing `Automation`/`RecipeDescriptor` mirror convention):

```ts
// electron/integrations/worker-spec-store.ts  (new)
export interface WorkerStep {
  agent: AIType            // 'claude' | 'codex' | 'gemini' | 'opencode' | 'custom' | ...
  customCliId?: string     // when agent === 'custom'
  model?: string           // opaque provider model id/alias; undefined = agent default
  effort?: 'low' | 'medium' | 'high'  // best-effort; only applied where the CLI supports it
  instructions?: string    // scoped harness text seeded as this step's initial input
  role?: string            // human label for the step, e.g. "explore", "implement"
}

export interface WorkerSpec {
  id: string
  name: string             // e.g. "triage-bug", "fix-lint", "explore→implement"
  description?: string
  steps: WorkerStep[]      // length 1 = single agent (Capa 1); length ≥2 = cooperative pipeline (Capa 2/B1)
  createdAt: number
  updatedAt: number
}
```

**Persistence** follows the validated-atomic pattern (Pattern C, mirroring `scheduler.ts`'s `loadAutomations`/`saveAutomations`): a versioned wrapper `{ version: 1, workers: WorkerSpec[] }`, atomic tmp+rename, tolerant per-record validation, at `<ravenHome>/.raven-nest/worker-specs.json`. The file path is injected (DI seam), not read from `ravenHome()` inside the module.

**Automation extension** — add optional fields to `Automation`/`AutomationInput` (`electron/integrations/scheduler.ts:14`, mirror `src/types.ts:223`):
```ts
  workerId?: string   // reference a worker-spec…
  model?: string      // …or inline model+effort (back-compat with existing `provider`)
  effort?: 'low' | 'medium' | 'high'
```
`provider` stays for back-compat (it maps to `steps[0].agent`).

## 4. Model flag per CLI (G2)

Extend `AI_CONFIG` (`src/types.ts:453`) with per-agent model capability:

```ts
claude:   { …, cmd: 'claude',     modelFlag: '--model', models: ['opus', 'sonnet', 'haiku'] },
codex:    { …, cmd: 'codex',      modelFlag: '--model', models: [...] },
gemini:   { …, cmd: 'gemini',     modelFlag: '-m',      models: [...] },
opencode: { …, cmd: 'opencode',   modelFlag: '--model', models: [...] },
copilot:  { …, cmd: 'gh copilot', /* no modelFlag → model selection hidden/no-op */ },
```

- When a worker-step has a `model` **and** the agent has a `modelFlag`, the launch command becomes `` `${cmd} ${modelFlag} ${model}` ``.
- Agents with no `modelFlag` (copilot, terminal, custom, browser): model field is hidden in UI and ignored at launch (**no-op**, never appended).
- `cmd === ''` (plain terminal / browser / custom-without-cmd): **never** append a flag — a model flag must not be prepended to an empty command.
- **`effort`**: `--effort` is an Orca-ism; most underlying CLIs do not expose a universal effort flag. v1 treats `effort` as optional per-agent capability (`effortFlag?` on `AI_CONFIG`); where absent it is a no-op. **Model is the guaranteed cost lever in v1; effort is best-effort.**

> ⚠️ **Implementation must verify the exact flag syntax per CLI** (via `--help` / context7) before shipping. The table above is the design intent, not verified syntax. Any agent whose real flag differs or is unsupported degrades to no-op, never to a broken command.

**Injection point:** the command string is resolved from `AI_CONFIG[...].cmd` in `NewPaneDialog.tsx:121` and passed via `onConfirm` → `App.addPane` → `PaneNode.cmd` → `pty.create` → `${cmd}\r` (`pty-manager.ts:146`). The clean place to append the model flag is **where `cmd` is resolved for launch** (the worker-spec launch path and `NewPaneDialog`), so `PaneNode.cmd` already carries the flag. The `${cmd}\r` write in `pty-manager` is the last-resort chokepoint but should stay dumb.

## 5. Where it lives in the hub (G3 — "adaptación, no panel aparte")

The hub today has tabs **Hub** (OrchestrationBoard + rail), **Connections**, **Recipes**, **Automations** (`IntegrationsHub.tsx:25,102-107`). Worker-specs plug into what exists:

1. **Automations tab becomes the home of "workers + when they run".** A *worker* is the reusable "what to run"; an *automation* is "run this worker on a schedule". `AutomationsView` gains a worker-spec **library** section (list + create/edit) alongside the schedule list. This is a generalization of the current tab, not a new tab. (Minor open item: exact label/segmented-control — see §10.)
2. **Board-open flow** (`openRow` → `WorktreePicker` → `onOpenWorktree(path, initialInput)`): the picker gains **"Run with worker: [dropdown]"**. Selecting a worker sets the agent+model+instructions for the opened session (Capa 1) and, for a multi-step worker, arms the A→B handoff (Capa 2).
3. **New-pane dialog** (`NewPaneDialog`): optionally seed from a worker-spec (pick worker → preselects agent+model). Non-blocking; the manual grid still works as today.

## 6. Data flow

### 6a. Capa 1 — model-per-task on manual / board launch (works today)
```
worker-spec (agent=codex, model=haiku, instructions)
  → resolve cmd = 'codex --model haiku'
  → PaneNode { cmd, initialInput: instructions, repoPath: worktreePath }
  → pty.create → `${cmd}\r`  (real CLI spawn)
  → TerminalPane injects instructions once on first output (TerminalPane.tsx:161)
```
This is the guaranteed cost win: the board-open path really spawns a CLI, so choosing a cheap-model worker actually runs the cheap model.

### 6b. Capa 1 — automations (plumbed, not live)
`Automation` carries `workerId`/`model`/`effort` → threaded into the `RunAutomationFn` seam (`scheduler.ts:304`) and `runAutomationStub` (`main.ts:2403`). Since headless spawn is stubbed (N4), v1 only stores + passes them through, ready for when Epic C's headless run lands.

### 6c. Capa 2 / B1 — sequential cooperative handoff
```
task worktree = one branch, agents run SEQUENTIALLY (no git conflict)
Step A (agent=opencode, model=cheap, role="explore"):
  launched with instructions ending: "When done, write your handoff summary to .nest/handoff.md"
  → A works, leaves file changes on disk, writes .nest/handoff.md
Advance (explicit "Hand off →" action, optionally auto-triggered by a watcher on .nest/handoff.md):
  → read .nest/handoff.md
Step B (agent=claude, model=strong, role="implement"):
  → setAddingPane({ worktreePath, initialInput: <handoff.md contents + step-B instructions> })
  → opens agent B in the SAME worktree, seeded via the existing initialInput mechanism
  → B sees A's on-disk changes + the digested handoff, works with a lean context
```
**Reuses the existing seeding path verbatim:** `onOpenWorktree`/`setAddingPane({worktreePath, initialInput})` (`App.tsx:1305,1313`) → `PaneNode.initialInput` (`types.ts:40`) → one-shot PTY injection (`TerminalPane.tsx:161-168`). The handoff file write is a new small helper (mirrors `.nest/TASK.md`/`.nest/spec.md` writes in `main.ts:2628,2672`).

**Advancement is explicit in v1** (button; optional file-watcher convenience). We do **not** build robust "agent A is done" detection (N3) — a reliable manual "Hand off now" is the contract; the watcher is a convenience that fires when `.nest/handoff.md` is created/updated.

## 7. Components (new + touched)

| Component | Change |
|---|---|
| `electron/integrations/worker-spec-store.ts` | **new** — `WorkerSpec`/`WorkerStep` types, load/save (atomic, versioned), `list/save/delete`, `runPipeline` helper stubs |
| `electron/main.ts` | register `new WorkerSpecStore()` (near `:166`); `workerspec:*` IPC (near `:890`); `.nest/handoff.md` writer + "advance handoff" IPC; thread model/effort into `runAutomationStub` |
| `electron/preload.ts` | expose `window.workerSpecs` (near `:31`) |
| `src/types.ts` | `AI_CONFIG` gains `modelFlag?`/`models?`/`effortFlag?` (`:453`); read-only `WorkerSpec` mirror; `Automation`/`AutomationInput` gain `workerId?`/`model?`/`effort?` (`:223`) |
| `src/components/AutomationsView.tsx` | worker-spec library section (list + editor); automation form gains worker/model/effort |
| `src/components/WorktreePicker.tsx` | "Run with worker" dropdown; arms handoff for multi-step |
| `src/components/NewPaneDialog.tsx` | optional "seed from worker" (preselect agent+model); build `cmd` with model flag (`:121`) |
| `src/App.tsx` | handoff advance wiring reuses `setAddingPane` (`:1305,1313`); model flag already baked into `cmd` upstream |

Each unit stays single-purpose: the store persists/validates; `AI_CONFIG` declares capability; the launch path composes `cmd`; the handoff helper writes/reads `.nest/handoff.md`; the UI edits/selects.

## 8. Error handling

- **Unknown/unsupported model for an agent** → drop the flag, launch the agent's default, surface a non-blocking warning. Never emit a broken command.
- **Empty `cmd`** (terminal/browser/custom-no-cmd) → never append a flag; model UI hidden.
- **`.nest/handoff.md` missing at advance** → block the advance with a clear message ("Step A hasn't written a handoff yet"), offer "open B anyway (no seed)".
- **Worker-spec store corrupt/partial** → tolerant load drops bad records (Pattern C), never throws on startup.
- **Agent B launched but worktree gone** → same `NO_WORKTREE` guard as `startWorkOnWorktree` (`main.ts:2631`).

## 9. Testing

- **Store**: unit — round-trip, versioned wrapper, tolerant load of a corrupt record, atomic write, id validation.
- **Model flag composition**: unit — `(agent, model) → cmd`: claude→`claude --model opus`; copilot→unchanged (no flag); empty cmd→unchanged; unsupported model→default+warning.
- **Automation extension**: unit — `AutomationInput` with `workerId`/`model` persists and mirrors; `provider`-only stays back-compat.
- **Handoff**: unit — `.nest/handoff.md` write/read helper; advance with/without the file; integration — a 2-step worker seeds step B's `initialInput` from the handoff (assert `PaneNode.initialInput`).
- **UI**: worker library CRUD in `AutomationsView`; "Run with worker" sets the resolved cmd. Follow the existing `__tests__/components` patterns.
- Full suite must stay green (baseline noted in memory as ~499 tests / ~8s).

## 10. Rollout / phasing (for writing-plans)

1. **P1 — Data + store.** `worker-spec-store.ts` + types + IPC + preload. Pure, testable, no UI.
2. **P2 — Model flag primitive.** `AI_CONFIG` capability + `(agent,model)→cmd` composer, applied in `NewPaneDialog`/launch path. **This alone delivers the token-cost win on manual launch.**
3. **P3 — Worker library UI + board-open.** `AutomationsView` library + `WorktreePicker` "Run with worker" (Capa 1 end-to-end).
4. **P4 — Automation plumbing.** `Automation` gains worker/model/effort; threaded into the stub (not live spawn).
5. **P5 — Capa 2 / B1 handoff.** `.nest/handoff.md` write/read + advance action (+ optional watcher) + seed step B via existing `initialInput` path.

Each phase is independently shippable; P2 is the fastest path to visible value.

## 11. Open questions (non-blocking; resolve in plan/impl)

- **OQ1** — Exact per-CLI model flag syntax + which models each supports (verify via `--help`/context7). Design degrades unsupported cases to no-op.
- **OQ2** — Does any target CLI expose a usable `effort`/reasoning flag? If none in v1, keep `effort` in the model but wire zero `effortFlag`s (pure no-op) until confirmed.
- **OQ3** — Automations tab label/layout for hosting the worker library (segmented control "Workers | Schedules"?) — cosmetic, decide in UI phase.
- **OQ4** — Auto-advance watcher on `.nest/handoff.md`: ship in P5 or defer to a fast-follow (manual button is the contract either way).
- **OQ5** — Should worker-specs be shareable to the team (via the existing Workspaces/Supabase sharing) as a fast-follow? Out of v1 scope; noted because it is the eventual "harness = the company" payoff.
