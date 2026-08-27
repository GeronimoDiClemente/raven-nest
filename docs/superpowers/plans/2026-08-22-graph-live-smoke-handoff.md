# Graph orchestration — in-app LIVE smoke: handoff (2026-08-22)

Pickup note so this branch (`feat/integrations`) can be continued from **any machine**.
Nothing here is implemented yet — it is the audit of *what blocks the in-app live smoke*
of the graph eval-loop, done on 2026-08-22 by reading the wiring end to end.

## What is already DONE (do not redo)

- **Engine (capa ①)** — `graph-template/-store`, `graph-runner`, `graph-orchestrator`
  (`planTick`: verdict pass, auto-repair, escalation, mode gating, exit-code→failed),
  `graph-handoff`, `graph-verdict`, `graph-review`, `graph-run-store`, `graph-config`,
  `graph-tick`. Full suite green.
- **main.ts effect layer** — `graphOrchestratorTick` (3s), pane spawn/kill, artifact read,
  event dedupe + persistence, and IPC: `graph:templates:*`, `graph:runs:list`,
  `graph:run:start` (`main.ts:3006`), `graph:node:attach` (`:3034`), `graph:run:setMode`
  (`:3044`), `graph:gate:approve` (`:3048`), `graph:gate:requestChanges` (`:3052`).
- **Board UI** — `src/components/GraphBoard.tsx` (+ `GraphNodeTerminal.tsx`), opened from
  the Sidebar. It can already start a run: template `<select>` + branch `<input>` →
  `handleStart` (`GraphBoard.tsx:169`) → `window.graphRuns.start`. Built-in templates:
  `full`, `quick-fix`, `review-only` (`graph-template.ts:101`). No `@xyflow/react`
  dependency was needed — the layout is our own `src/lib/graph-view.ts`.
- **Headless LIVE smoke with a REAL `claude`** — `electron/__tests__/graph-eval-loop.live.test.ts`,
  gated by `GRAPH_LIVE_SMOKE=1`. Already run for real; it produced the `parseVerdict`
  nested-verdict fix (commit 8ffb56e). Re-run with:
  `GRAPH_LIVE_SMOKE=1 npx vitest run electron/__tests__/graph-eval-loop.live.test.ts`
- **Deterministic headless smoke** — `electron/__tests__/graph-eval-loop.smoke.test.ts`
  (in the normal suite): auto-repair convergence + gate-mode approve.

## What is MISSING for the in-app live smoke

### Environment (no code)

1. Launch the dev app **without killing the Nest host**: pass an own `--user-data-dir`
   (the single-instance lock in `main.ts` is keyed to the userData dir).
2. A repo open in a tab with its local path linked — `handleStart` refuses without
   `activeRepoPath`, and `createWorktreeForBot` (`main.ts:1224`) needs a real git repo.
3. Agent CLI auth: headless launch picks the agent's **first saved account** dir and
   redirects `HOME` to it (`accountDirForAgent`, `main.ts`). If that account dir is not
   logged in, the pane opens on a login screen. No saved account → real `HOME` (fine).
4. `claude` / `codex` on PATH (verified on the main Windows PC).

### Blockers (code) — A and B are hard blockers

> **STATUS 2026-08-25: A + B are FIXED** (this branch). `launchCommand`
> (`graph-tick.ts`) now emits a headless command that reads the composed prompt
> from a file and `exec`s the CLI so the pty closes with its exit code:
> POSIX `exec claude -p "$(cat '<wt>/.nest/graph/<node>.prompt')" --dangerously-skip-permissions`
> (codex → `exec codex exec --dangerously-bypass-approvals-and-sandbox "$(cat …)"`);
> PowerShell variant `& … ; exit $LASTEXITCODE`. main.ts writes the prompt file
> before spawn and no longer does the delayed `ptyManager.write`. 7 new unit
> tests, full suite (896) + typecheck green. **Still to do:** the in-app live
> smoke in `auto` mode, and **C** below. Two caveats surfaced while fixing:
> - **codex is unverified** — its `exec` + `--dangerously-bypass-approvals-and-sandbox`
>   flags are best-guess (codex is broken on the current Mac: missing vendored
>   binary), tune in the smoke. Smoke a claude-only template (`review-only`) first.
> - **gemini/copilot/opencode are now skipped** (return '' from `launchCommand`)
>   — no verified headless flags yet, so a custom template using them won't spawn
>   until their `HEADLESS` entry is added. Not in any built-in template.

**A. No node can ever reach `done`.**
`deriveAgentState` only returns `done` when `!hasPty` (`agent-status.ts:37`), and
`samplePane` derives `hasPty` from `ptyManager.exists(paneId)` (`main.ts:2907`).
But `ptyManager.create` spawns a **shell** and writes the command into it
(`pty-manager.ts:39`), so when `claude` exits the shell survives → `hasPty` stays true →
`mapAgentState('idle') === 'running'` (`graph-orchestrator.ts:23`) → the run stalls on the
first node forever. This is the severe form of the previously-noted "Concern D" (it is not
only the missing exit code — `done` itself never fires). Same root cause kills the
exit-code→failed path in the app (`paneExitCode` is only set on pty exit).

**B. The CLIs are launched interactive and unsandboxed.**
`launchCommand` returns bare `claude` / `codex` (`graph-tick.ts:51`), and the composed
prompt is typed into the TUI 1500 ms later (`main.ts:2988`). In a fresh worktree the CLI
asks to trust the folder and then asks per-tool permission → the agent never writes its
`.nest/graph/*` artifact on its own. The headless live test works because it uses
`claude -p "<input>" --dangerously-skip-permissions`.

> **A and B share one fix:** launch each node headless — `claude -p "<input>"
> --dangerously-skip-permissions` (equivalent for codex) with the shell exiting when the
> CLI does (`exec …` / `…; exit`), instead of interactive TUI + delayed `ptyManager.write`.
> That makes the pty close on finish (→ `done` + a real exit code) and removes the
> multi-line prompt-injection timing risk. `graph:node:attach` still works for watching
> the scrollback live.

**C. Human decisions are not reachable from the renderer** (only needed to smoke
`gate`/`step` mode). `graph:run:setMode`, `graph:gate:approve` and
`graph:gate:requestChanges` exist in main but are **not exposed in `preload.ts`**
(the `graphRuns` bridge only has `list`/`start`/`attach`) and have no button. Exposing
them + a minimal approve / request-changes control does **not** depend on the
`feat/code-editor-integration` merge — only the full capa ② card (`GraphReviewCard.tsx`)
and capa ③ (`Open diff in editor`) do.

## Suggested order when picking this up

1. Fix A+B in `graph-tick.ts` (`launchCommand` → headless argv) + `main.ts` spawn path;
   unit-test `launchCommand`'s new shape; then run the in-app smoke in `auto` mode on a
   throwaway repo and watch the board.
2. Then C, if the gate path should be smoked in the same pass.
3. Known minors still open (from the final review): `step` mode behaves like `gate`;
   a failed **leaf** (e.g. crashed tester) stalls the run without escalating;
   `revisionNote` is stamped on every coder; the `seen` set is not cleared on a re-run.

## Where the rest lives

- Spec/plan: `docs/superpowers/specs/2026-08-{17,20}-graph-*`,
  `docs/superpowers/plans/2026-08-{17,20}-graph-*`.
- Mockups: `docs/superpowers/mockups/2026-08-17-graph-orchestration/` (board) and
  `docs/superpowers/mockups/2026-08-20-graph-review-eval-loop/` (review direction C deck).
- `docs/superpowers/` is gitignored; these files are force-added on purpose.
