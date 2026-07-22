# Hub corrections — continuation plan (2026-07-21)

**Branch:** `review/hub-stats` = `main` + PR #21 (Hub overlay) + PR #13 (team-stats),
merged locally, translated to English, plus corrections. **Not pushed, not merged to
`main`.** We continue here tomorrow.

## Done so far (committed on `review/hub-stats`)
- `2c93a33` — i18n: Hub + team-stats translated to English (UI, comments, tests, docs)
- `050a1c7` — **#1 Active dot**: fires only on *visible* output (ignores cursor/escape/title
  repaints; spinner counts), quiet window 2s→3.5s, steady dot (no pulse) + reduced-motion,
  fixes the pty-events teardown bug (`resetHubActivity` via `onStopListening`)
- `c06d21f` — **#5 rename + labels**: double-click the pane-header label to rename ANY pane
  (`updatePaneAnywhere` → `customLabel`); Hub tiles show the custom label
- `0b60765` — **#8 tab overflow**: "all workspaces" menu, wheel→horizontal, auto-scroll active.
  ⚠️ **The dropdown-menu approach is NOT what Gero wants — rework (see below).**
- `e74f65e` — **#2+#3 Hub sidebar**: hides the repo context group on a Hub tab, shows a
  workspace/terminal builder (`HubSidebarPanel`). ⚠️ **The #3 click behaviour is WRONG — rework (see below).**
- `2554bfc` — #8 bugfix: overflow chevron only shows when the tab strip actually overflows

State: **233 tests green**, `tsc -b` no new errors.

## ⚠️ Conceptual correction from Gero (2026-07-21) — REWORK #3 (+ merge with #4)
The Hub is a **composable, filterable VIEW of terminals** across all workspaces — a way to
**see and filter** terminals, NOT a launcher.
- Clicking a terminal in the Hub (sidebar/picker) must **NOT navigate to its workspace**. It
  must **bring that live terminal (with its ongoing content) into the Hub** — focus it / include
  it in the Hub grid.
- The Hub sidebar's job is to **pick / filter which terminals (from which workspaces) show in
  the Hub grid**. Click = include/focus in the Hub.
- This **converges with #4** (group by workspace + multi-select show/hide): the Hub is a
  filtered/composed grid; the sidebar/toolbar chooses what appears.

### What's wrong today (to rework)
- `HubSidebarPanel` `onJumpToPane` → `handleHubJump` (navigates away). Change to
  "focus/include the terminal in the Hub grid".
- `onAddTerminalToWorkspace` currently does `setActiveTabId + setAddingPane` (leaves the Hub).
  Reconsider under the new model.

## #8 rework — no overflow menu; all tabs stay visible
Gero (2026-07-21): the fix must **NOT** be a little bar that pops out a menu. **All workspace
tabs must stay VISIBLE even when the window is small** — the tabs should compress/shrink to fit
(e.g. shrink to a coloured chip / dot + short label when very crowded) so every workspace is
reachable, **without breaking** the layout. Remove the `⌄` overflow dropdown (`0b60765` /
`2554bfc`). Keep wheel→horizontal + auto-scroll-active only if still useful; the primary
requirement is "everything visible, compressed to fit".

## Bugs pending
1. **Collapsed sidebar looks broken on a Hub tab**: `HubSidebarPanel` renders a bare column of
   coloured dots (labels hidden) when the sidebar is at 44px. Fix: hide the builder when
   `!expanded`, or give it a proper collapsed presentation. (See screenshot 2026-07-21.)
2. ~~Overflow chevron always visible~~ — fixed in `2554bfc`.
3. **Hub sidebar aesthetic (Gero, 2026-07-21)**: it MUST reuse the existing sidebar look —
   `.sidebar-item`, existing tokens and patterns — **no distinct visual language**. Rework the
   bespoke `.hub-side-*` styling so the Hub sidebar is visually consistent with the rest of the app.

## Plan for tomorrow (order)
1. **Rework #3 + #4 (unified): the Hub as a filterable view.**
   - Model a "which panes are shown in the Hub" selection state.
   - Sidebar/toolbar toggles inclusion per terminal and per workspace (groups).
   - Click a terminal in the sidebar = focus/scroll to its tile in the Hub grid (ensure it's
     included). Do NOT navigate.
   - Group tiles by workspace in the grid (#4) + multi-select show/hide.
   - Decide: keep "double-click = jump to the pane in its workspace" as an explicit *secondary*
     action? (Primary action is NOT jumping.)
2. **Fix collapsed-sidebar rendering** (hide builder when `!expanded`).
3. **Rework #8**: drop the overflow dropdown; make all tabs compress to stay visible when the
   window is narrow (chip / dot when crowded), without breaking layout.
4. **#6 team-stats pivot** — design already done (flow & health dashboard; data-availability
   matrix; cycle time / review latency / PR size computable now, DORA deploy = phase 2).

## Open decisions
- Reconcile the Hub toolbar filters (All/Active/Pinned) with the sidebar picker (redundancy).
- How do you *remove* a terminal from the Hub (exclude) vs include?
- Merge vs split of `review/hub-stats` when everything is done (merge combo to main, or split
  fixes back to `feat/hub-overlay` / `feat/team-stats`).

## Housekeeping
- `feat/tutorial-interactivo` has unpushed local commits (untouched).
- Git stash `wip CLAUDE.md pre-review PR21` still holds an uncommitted `CLAUDE.md` edit — restore
  when switching back to `feat/tutorial-interactivo`.

## Run / verify
- Dev: `npm run dev` · Tests: `npx vitest run` · Types: `npx tsc -b --noEmit`
