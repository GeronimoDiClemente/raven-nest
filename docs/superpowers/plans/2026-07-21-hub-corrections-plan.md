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
- `e170570` — **#8 REWORK (done)** + **collapsed-sidebar fix**: removed the overflow dropdown; tabs
  now compress (`.tab` min-width 44px) so all workspaces stay visible when narrow; Hub builder
  hidden when the sidebar is collapsed
- `0463397` — **#3 click-focus (v1, done)** + **aesthetic restyle (done)**: Hub sidebar terminal
  click now FOCUSES the tile in the Hub (`focusTerminal`, no navigation); HubSidebarPanel restyled
  onto the existing `.wt-*` / `.sidebar-item` aesthetic (bespoke `.hub-side-*` deleted)

State: all tests green, `tsc -b` no new errors.

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

## #8 rework — no overflow menu; all tabs stay visible  ✅ DONE (`e170570`)
Gero (2026-07-21): the fix must **NOT** be a little bar that pops out a menu. **All workspace
tabs must stay VISIBLE even when the window is small** — the tabs should compress/shrink to fit
(e.g. shrink to a coloured chip / dot + short label when very crowded) so every workspace is
reachable, **without breaking** the layout. Remove the `⌄` overflow dropdown (`0b60765` /
`2554bfc`). Keep wheel→horizontal + auto-scroll-active only if still useful; the primary
requirement is "everything visible, compressed to fit".

## Bugs pending
1. ~~Collapsed sidebar looks broken on a Hub tab~~ — **DONE (`e170570` + `0463397`)**: the Hub
   builder is hidden when collapsed and shows only the New-workspace icon.
2. ~~Overflow chevron always visible~~ — fixed in `2554bfc`, then the whole menu removed in `e170570`.
3. ~~Hub sidebar aesthetic~~ — **DONE (`0463397`)**: restyled onto `.wt-*` / `.sidebar-item`; bespoke
   `.hub-side-*` deleted.

## ⚠️ DECISION NEEDED from Gero (blocks the full #3+#4 rework)
The full model — group tiles by workspace + scroll to a specific tile + show/hide + >12 terminals —
**cannot** be built on the Hub tab's current substrate (PaneLayoutEngine + real `TerminalPane`, fixed
geometric layout, 12-cap, no scroll, no sections). The design (workflow `hub-filterable-view-design`,
journal.jsonl in the wf transcript) proposes rendering the Hub **tab** on the OVERLAY's substrate: a
scrollable, grouped `HubGrid` of `HubTile` **mirrors** (`useHubTerminal` read/echo xterms that attach
to the live PTY by id). That unlocks grouping + scroll-to-tile + unlimited tiles + show/hide — **but
each Hub tile becomes a read/echo mirror and LOSES the per-tile `TerminalPane` chrome** (zoom, notes,
colour picker, close, rename, PR/join buttons). Mitigation: an explicit "open in workspace" button per tile.

**Question for Gero:** OK to make the Hub-tab tiles read/echo mirrors (view + click-to-type, plus an
"open in workspace" button for full ops) in exchange for grouping + scroll + show/hide? Or must the
Hub keep full `TerminalPane` parity (which blocks grouping/scroll)? Everything in the plan below hinges
on this. (Perf note: a live xterm per terminal may need lazy-mount/virtualization; show/hide is the
user-facing mitigation.)

Minor decisions: keep the per-workspace "+ terminal" (it navigates — an explicit create) or drop it?
Per-terminal hide or just per-workspace? Should the All/Active/Pinned toolbar counts reflect the shown
(post show/hide) set?

## Plan for tomorrow (order)
✅ **Done tonight (autonomous):** #8 rework (tabs compress), collapsed-sidebar fix, #3 click-focus v1
(sidebar click focuses the tile, no navigation, works ≤12), aesthetic restyle. What's left:

1. **Full #3+#4 rework — the Hub as a filterable grid** (BLOCKED on the decision above):
   - Swap the Hub-tab substrate to a scrollable grouped `HubGrid` of `HubTile` mirrors.
   - `hubHiddenWorkspaces?: string[]` per Hub tab (persisted in session) → multi-select show/hide (#4).
   - Group tiles by workspace (`.hub-group` / `.hub-group-header`); extend the v1 click-focus to a
     `hubFocusTarget {id, nonce}` state that scrolls the tile into view (needed once the grid scrolls / >12).
   - Full per-file plan is in the workflow result (`hub-filterable-view-design`, journal.jsonl).
2. **#6 team-stats pivot** — design already done (flow & health dashboard; cycle time / review latency /
   PR size computable now, DORA deploy = phase 2).

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
