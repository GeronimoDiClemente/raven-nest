# Worktrees Tutorial — Interactive Hybrid + Polish — Design Spec

**Date:** 2026-05-27
**Status:** Approved (brainstorming) — pending spec review
**Builds on:** the working Worktrees tutorial (`feat/tutorial-interactivo`) after the isolation fix (`7cf14a9`), the spotlight double-dim fix (`5777814`), and the initial workspace mock (`7e6521a`).

## Goal

Turn the Worktrees tutorial from a click-through coachmark walk into a **guided-interactive** experience where the user actually performs the key actions, looks polished (not generic), covers two missing flows (drag-a-worktree-to-open-a-terminal, change a terminal's folder), and reads in the app's language. The app UI is **English**; the tutorial is **bilingual (English default, Spanish when the locale is Spanish)**.

## Principles / constraints

- **App copy is English-first.** No Spanish hardcoded in app-facing strings. Tutorial copy is localizable (see i18n).
- **Isolation is sacred** (already fixed): the sandbox renders inside `BridgeProvider`; the live app is untouched. Nothing here may reintroduce global bridge state or `document`-wide anchor queries.
- **Real where cheap, faithful-interactive-mock where PTY makes "real" expensive.** Mounting real terminal panes spawns node-pty; we do NOT mount them. The sidebar/diff/modal components are already real (mocked bridge) and stay real.
- **Never trap the user.** Action-driven steps still expose a `Next` fallback so the tour always advances.

## What is REAL vs SIMULATED

| Flow | Treatment |
|---|---|
| Click `+`, fill branch, pick preset, **Create** → worktree appears (running→done) | **REAL** — `NewWorktreeModal` + `WorktreesSection` already mounted with mocked `bridge`; the demo worktree store mutates for real. |
| Click a diff chip / row → diff panel opens with the demo diff | **REAL** — `DiffViewerPanel` already mounted with mocked `bridge`. |
| **Drag a worktree into the workspace → open a terminal in it** | **INTERACTIVE MOCK** — real HTML5 drag from the real `WorktreesSection` `.wt-item` (it already sets `dataTransfer['application/x-raven-worktree-path'] = repoPath`); the mock workspace implements the drop target and "opens" a fake terminal pane (no PTY). |
| **Change a terminal's folder (Sync cwd)** | **INTERACTIVE MOCK** — the fake pane shows a `Sync cwd` button when the active worktree differs from the pane's running folder; clicking it "restarts" the fake terminal in the new folder (mock state only). |

## Architecture / components

### 1. Interactive workspace mock — `src/tutorial/DemoWorkspaceMock.tsx` (evolve the existing file)

Today it is a static replica. Make it stateful and interactive:

- **Local state** (in the mock, not the demo harness):
  - `panes: { id: string; branch: string; repoPath: string; runningRepoPath: string }[]` — open fake terminals. Seed with one (`feat/dark-mode`) so the workspace isn't empty.
  - `dropActive: boolean` — drives the `.grid-workspace--drop-target` highlight.
- **Drop target** on the `.grid-workspace`/`.workspace` container, mirroring the real App handlers (from `App.tsx:891-913`):
  - `onDragOver`: if `e.dataTransfer.types` includes `application/x-raven-worktree-path`, `preventDefault()`, set `dropEffect='copy'`, `setDropActive(true)`.
  - `onDragLeave`: `setDropActive(false)`.
  - `onDrop`: read the path from `application/x-raven-worktree-path`, derive the branch (look it up in the demo worktree store by repoPath), push a new fake pane, `setDropActive(false)`. Emit a callback so the tour can advance.
- **Fake terminal pane** (the existing `.terminal-pane` chrome, now driven by the pane list):
  - Header: `.pane-color-btn`, `.pane-ai-label` (CLAUDE), a port chip, the branch as the note, plus a **`Sync cwd`** button (`.pane-sync-cwd-btn`) shown only when `runningRepoPath !== repoPath`.
  - Body: a canned Claude Code session whose first line shows the pane's branch/cwd.
  - `Sync cwd` click: set `runningRepoPath = repoPath`, briefly show a "Restarting…" line, then the session re-renders for the new folder. Emit a callback so the tour can advance.
- **Driving the cwd divergence:** when the user selects a different worktree in the sidebar while a fake pane exists, the mock sets that pane's `repoPath` to the selected one (leaving `runningRepoPath` stale) → the `Sync cwd` button appears. The sandbox already routes `WorktreesSection.onSelect`; extend it to also notify the workspace mock (lift a small piece of shared state into `TutorialSandbox`, or pass an `onWorktreeSelected` handler into the mock).

> The mock stays purely visual re: process — no `bridge.pty`/PTY. Drag uses the REAL dataTransfer MIME so the drag genuinely originates from the real `WorktreesSection`.

### 2. Richer, less-generic mock ("más cosas en el mockup")

- Seed **two terminal panes** in a vertical split: a CLAUDE pane (the dark-mode session) and a second terminal pane (a different agent label running another task, e.g. tests), so the workspace reads as a real multi-pane session, not one box. The newly drag-opened pane becomes a third.
- More realistic canned output (a short, believable Claude Code exchange + a dev-server line + a prompt cursor). Use the real pane chrome classes throughout.

### 3. Action-driven tour + new steps — `src/tutorial/tours/worktrees.ts`

- Steps advance on the **real action** where one exists. Concrete mechanism: `OnboardingTour` gets an optional `advanceSignal?: number` prop; when it increments, the tour advances one step (guarded so it only advances while on the step that expects it, identified by the current step's `id`). `TutorialSandbox` owns the signal and increments it when the mock emits an action callback (`onDrop`, `onCreate`/worktree-created, `onSyncCwd`, `onDiffOpen`). `advanceOnClick` stays for pure click steps; `Next` remains a fallback on every step so the user is never trapped.
- **New steps** (English shown; Spanish in i18n table):
  - *Open a terminal in a worktree* — "Drag a worktree from the list into the workspace to open a terminal that runs in that worktree's folder." (anchors the list; advances on drop)
  - *Switch a terminal's folder* — "Click another worktree to point this terminal at it, then hit **Sync cwd** to restart it there." (anchors the `Sync cwd` button; advances on sync)
- Re-order so the flow reads: intro → create → list → diff → **drag-to-terminal** → **sync cwd** → PR/push → context menu.

### 4. Tooltip smaller + English engine — `src/tutorial/OnboardingTour.tsx` + CSS

- `.tour-tooltip`: reduce width (~336px → ~260px), padding, and font sizes ~20-30%.
- Engine buttons to **English**: `Atrás`→`Back`, `Saltar tour`→`Skip`, `Siguiente →`→`Next →`, `Listo`→`Done`. Badge stays `n / N`. (These become i18n strings too.)

### 5. i18n (tutorial-scoped, lightweight) — `src/tutorial/i18n.ts` (new)

- Each `TourStep`'s `title`/`body` becomes `{ en: string; es: string }` (or a `Localized` type). Engine button labels likewise.
- `resolveTutorialLocale(): 'en' | 'es'` — returns `'es'` only when `navigator.language` starts with `es`, else `'en'` (English default, matching the app). A tiny `t(localized)` helper picks the string.
- NOT app-wide i18n — scoped to the tutorial module. No new dependency.

## Data flow

`WorktreesSection` (real, mocked bridge) → user drags `.wt-item` (real dataTransfer) → `DemoWorkspaceMock` drop handler reads the MIME, adds a fake pane, notifies `TutorialSandbox` → `OnboardingTour` advances. `WorktreesSection.onSelect` → `TutorialSandbox` updates the focused fake pane's `repoPath` (divergence) → `Sync cwd` appears → click → mock updates `runningRepoPath` + notifies tour.

## Testing

- **Unit (jsdom):** `DemoWorkspaceMock` — dropping a worktree (synthetic `DataTransfer` with the real MIME) adds a pane; `Sync cwd` appears on divergence and clears it on click.
- **i18n:** `resolveTutorialLocale` + `t()` pick es vs en correctly; every step has both `en` and `es`.
- **Integration:** the existing `tutorial-isolation.test.tsx` (real WorktreesSection + sandbox don't cross-contaminate) and `worktrees-tutorial.test.tsx` (walk the tour) must stay green, updated for the new step count + English `Next/Done` labels.
- **No-real-API guard** stays: the sandbox never calls real `window.pty`/`worktree`/`diff`.
- **Manual (Electron):** open from Settings → Tutorial; drag a worktree → fake terminal opens; switch worktree → Sync cwd → "restarts"; confirm no real PTY/worktree side effects and English/Spanish copy by locale.

## Out of scope

- App-wide i18n. Mounting real terminal panes / real PTY in the tutorial. Replicating the tutorial for other sections (My Repos/Teams) — later.

## Open follow-up (not blocking)

- Auto-launch stays as-is (now isolated/safe); revisit whether first-run should auto-open full-screen or only open from Settings, given it surprised the user during testing.
