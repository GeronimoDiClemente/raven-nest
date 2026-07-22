# Hub — compact cross-workspace terminal view (overlay)

**Date:** 2026-07-14
**Status:** proposal — implemented in `feat/hub-overlay` and left as a PR for team review. Not merged without explicit OK.
**Author:** Matías (assisted design)

## Problem

Each workspace (tab) shows only its own panes. With agents running in 2–3 workspaces at once, there's no way to see what's happening in the others, or to answer a prompt from another workspace without blindly switching tabs and coming back. The only current cue is the green activity dot on the tab (`.tab-activity-dot`), which doesn't say which pane or what it needs.

## Solution (v1)

A **"Hub"** overlay that opens with `Ctrl+Shift+O` (`Cmd+Shift+O` on Mac) on top of the current workspace and shows, in a grid, all the live terminals from every workspace. It is **interactive**: what you type goes to the focused terminal. `Esc` closes and returns focus exactly to the previous pane.

Approved mockups: variant B (overlay) from the A/B/C comparison. The grid is built as a component independent of its container, so it can later be promoted to a fixed "Hub" workspace (variant A) without redoing anything.

### Entry points

1. Global shortcut `Ctrl/Cmd+Shift+O` (toggle).
2. "Hub: view all terminals" entry in the Command Palette.
3. Button in the tab bar (to the right of the `+`), with an activity dot when a pane in a non-visible workspace has activity.

### What each tile shows

The same visual language as the current pane (`color-mix` border with `--pane-color`, tinted header, color dot, AI label in uppercase, account) plus:

- **Origin workspace chip** (`.pane-pid-chip` style, blue) with the tab name.
- Existing activity label (`.pane-activity-label`) / `ended` badge if the process died.
- **Pin** button in the tile header.
- Content: a real xterm connected to the existing PTY (replay of the last ~200 buffer lines + live stream).

### Filters (top row of the overlay)

`All` (default) · `Active` (busy or with recent activity) · `Pinned` · per-workspace chips. The last chosen filter is remembered in `localStorage` (not worth touching the session format). Per-filter counters.

### Interactions

| Gesture | Action |
|---|---|
| Click on tile | Focus: the keyboard goes to that terminal |
| `Tab` / `Shift+Tab` | Cycle focus between tiles |
| Double click or `Enter` on the focused tile | Jump to that pane in its workspace (closes the overlay, activates the tab, focuses the pane) |
| `Esc` | Close the overlay and return focus to the previous pane |
| Pin in header | Toggles the pane's `pinned` |
| `Ctrl/Cmd+Shift+O` | Toggle open/close |

With more than 12 tiles after filtering: simple pagination (12 per page), to bound the number of live xterms.

## Approved addition (2026-07-14): Hub as a workspace from the `+`

In addition to the overlay, the Hub can be created as **just another tab**. Chosen interaction (mockup "A"): the `+` creates an empty workspace as it does today (one click, no changes); in its **empty state** (`EmptyState`), next to "+ New Terminal", **"▦ View all terminals (Hub)"** appears. Tapping it converts that tab into the Hub view (name → "Hub", ▦ icon on the tab), and its content is the grid of all the terminals from the other workspaces. The overlay (`Ctrl/Cmd+Shift+O`) stays the same; both share the same `HubView` core.

- The overlay's grid is refactored into `HubView` (filter toolbar + pagination + keyboard + `HubGrid`). `HubOverlay` becomes a wrapper (backdrop + title + `HubView`); `HubWorkspace` mounts `HubView` inline as the content of the active tab.
- A Hub tab has `isHub: true` and `panes: []`; it's excluded from the filter sources/chips. When it's the active tab, the other tabs become inactive → their real `TerminalPane`s unmount → the Hub tiles are the only view of those PTYs (no double-view, cleaner than the overlay).
- `isHub` persists in the session (save/restore/migrate). The `EmptyState` button only appears if there are terminals in some other workspace.
- Known limitation (v1): if you restore the session with the Hub tab active, the other tabs' PTYs don't exist yet (they're created when their `TerminalPane`s mount), so those tiles look empty/ended until you visit those tabs once. Documented in the PR.

## Out of scope (v1)

- Persistent side panel (variant C).
- Fine-grained "waiting for input" detection (prompt heuristics): v1 uses the existing signals (busy/activity/idle/ended).
- Cross-workspace broadcast from the Hub.
- Reordering/moving panes from the Hub.

## Architecture

No new IPC and no new store. All the pieces already exist:

- **PTYs**: they live in the main process for all workspaces (`electron/pty-manager.ts`, `Map<paneId, IPty>` + 10k-line buffer). `window.pty.write(paneId, …)` is already global.
- **Data**: `tabs.flatMap(t => t.panes)` in `App.tsx` (single source of truth; the overlay doesn't copy state).
- **Stream**: `subscribeToPtyData` (`src/pty-events.ts`) delivers `(paneId, data)` from every terminal with a single listener.
- **Activity state**: the existing `busyPanes` and `tabActivity` in `App.tsx`.

### New components (`src/components/`)

1. **`HubOverlay.tsx`** — overlay container. Mounted in `App` gated by `hubOpen` (useState in App), same pattern as Command Palette / GlobalSearch. Handles: the shortcut, `Esc`, priority over other overlays (if the palette or search are open, `Esc` closes those first; the Hub shortcut doesn't open if a modal dialog is up), saving/restoring the previously focused pane (`terminal-registry`), pagination and the filter row.
2. **`HubGrid.tsx`** — pure, reusable grid. Props: `entries: HubEntry[]` (`{ pane, tabId, tabName, tabColor, busy, ended }`), `focusedPaneId`, callbacks (`onFocus`, `onJump`, `onTogglePin`). No knowledge of the container or of App. This is the piece later mounted in a Hub tab.
3. **`HubTile.tsx`** — mini-pane. Header reusing existing pane classes/styles + workspace chip + pin. Body: its own xterm instance (read-only until focused) connected by `paneId`:
   - mount → `window.pty.getBuffer(paneId)` (trimmed to ~200 lines) → `write()` → subscription to the global stream filtering by its `paneId`;
   - unmount → `term.dispose()`; **never** kill the PTY (same contract as `TerminalPane`).

### Changes to existing code

- `App.tsx`: `hubOpen` state, mounting `HubOverlay`, Command Palette entry, tab bar button, "jump" handler (setActiveTabId + pane focus). Derive `HubEntry[]` with `useMemo` over `tabs`/`busyPanes`/`tabActivity`.
- `src/types.ts`: `pinned?: boolean` on `PaneNode` and `SessionPane` (persists with the existing session save/restore; trivial migration: absent = false).
- `src/styles/global.css`: new `/* ── Hub Overlay ── */` section reusing tokens (`--raven-blue`, `--pane-color`, etc.). No new hardcoded colors.

## Key technical decision: PTY size

A PTY has a single cols×rows; there are two possible views of the same PTY (the real pane + the Hub tile).

**Decision:** only the **focused tile** resizes the PTY to its size (so you can interact with TUIs consistently). Unfocused tiles render the buffer without resizing — there may be imperfect wrapping, acceptable in a compact view. When the overlay closes, the active workspace's mounted panes are re-fitted (`fit()`), which is what already happens on a remount. It's tmux's standard trade-off with multiple clients.

Residual risk: a TUI agent in the active workspace visible behind the overlay redraws small if its tile takes focus. Mitigation: if the pane belongs to the active workspace, focusing its tile does **not** resize (it's already mounted at real size; only input is routed).

## Performance

- xterm only for the tiles on the visible page (max 12); `dispose()` on paginate/filter/close.
- Replay bounded to ~200 lines per tile.
- Single subscription to the data bus in `HubOverlay`, internal fan-out to the tiles (not 12 IPC listeners).
- Overlay closed = zero cost (not mounted).

## Errors and edge cases

- **Dead PTY**: tile with the existing `ended` badge; to relaunch, jump to the pane (the restart lives there).
- **Closing a pane/workspace with the Hub open**: the grid is derived from `tabs` on every render; the tile disappears on its own. If it was the focused one, focus moves to the next.
- **Active workspace inside the Hub**: its panes also appear (with their chip), so the view is complete and predictable.
- **0 results after filtering**: empty state with a hint about the active filter.

## Testing (per CONTRIBUTING: exercise in the real app)

- `npm run build` clean (TS strict).
- Manual (documented in the PR): 3 workspaces with agents → open the Hub → type in a terminal from another workspace → verify it arrives; Enter jumps to the correct pane; Esc returns focus; pin + Pinned filter; an ended pane shows the badge; a session with `pinned` survives a restart.
- Playwright E2E (if the repo's harness allows it without friction): open the overlay, type cross-workspace, verify the echo in the buffer.
- Smoke on Windows (local dev) and ask for Mac/Linux verification in the PR (team requirement).

## PR checklist (team controls)

- [ ] Focused PR: only this feature, no "while I'm here".
- [ ] Screenshots/recording of the overlay in the PR body (CONTRIBUTING requirement for UI).
- [ ] The *why* in the body; the diff shows the *what*.
- [ ] No new dependencies.
- [ ] Existing tokens/styles, zero new hardcoded colors.
- [ ] Visual review in the real app before requesting review.
- [ ] Note on performance (bounded xterms, bounded replay) and security (no new IPC, no new surface).
- [ ] **Not merged**: left for Gero's review and merge.
