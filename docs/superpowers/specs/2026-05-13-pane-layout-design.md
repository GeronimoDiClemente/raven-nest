# Pane Layout Engine — v1.1 design

**Status**: approved (brainstorming) — pending implementation plan
**Branch**: `feat/free-grid` (base: tag `v1.0.1`)
**Target release**: `v1.1.0`

## Problem

In v1.0.x, the workspace uses a fixed `rows × cols` grid (`PanelGroup` from `react-resizable-panels`). Layouts are picked from a dropdown of presets in the sidebar (1×1, 1×2, 2×2, …) and panes live at fixed cell indices.

Limitations:
- Adding a pane forces the user to first reshape the grid; the sidebar `LayoutPicker` is a friction point.
- Odd pane counts (3, 5, 7) waste space because the grid is always rectangular.
- No way to switch between alternative arrangements for the same N (e.g. "3 cols" vs "master + stack" for 3 panes).
- Dragging the root repo or a worktree from the sidebar into the workspace was never possible.

The earlier attempt in this branch — a free-positioned grid via `react-grid-layout` with `noCompactor` and `bounded: false` — overshot in the opposite direction: panes can be dragged outside the viewport (confirmed visually) and the user has no guidance on where to put new panes.

## Goal

A tiling layout engine where:
- Adding/removing a pane auto-applies a sensible default arrangement.
- The user can switch between alternative layouts for the current pane count via a one-click selector.
- Split proportions are user-adjustable with drag handles.
- Panes can be rearranged by drag-and-drop (swap A↔B). PTYs survive moves, resizes, and layout switches.
- Nothing can be dragged out of the viewport.
- Worktrees can be dropped from the sidebar to spawn a new pane preloaded with that path.

## Non-goals

- Free positioning (no Superset/Grafana-style absolute placement).
- Cross-tab pane moves.
- Floating/popout panes.
- Animated transitions between layouts (target: instant snap).
- BSP-style tree of arbitrary splits.

---

## Architecture

```
┌─ WorkspaceTab (state) ────────────────────────┐
│  layoutId: LayoutId                            │
│  panes: PaneNode[]   ← positional             │
│  splitRatios: Record<NodePath, number[]>      │
└────────────────────┬───────────────────────────┘
                     │ resolved by
                     ▼
┌─ getPreset(layoutId) → LayoutPreset ──────────┐
│  slotCount: number                             │
│  root: Split  (recursive H/V/pane tree)        │
└────────────────────┬───────────────────────────┘
                     │ rendered by
                     ▼
┌─ <PaneLayoutEngine> ───────────────────────────┐
│  recursive renderSplit() →                     │
│    nested <PanelGroup>/<Panel>/<ResizeHandle> │
│    leaves: <TerminalPane key={pane.id} />     │
└────────────────────────────────────────────────┘
                     ▲
                     │ wraps
┌─ <DndContext> + <SortableContext> ─────────────┐
│  drag handle = .pane-header                    │
│  onDragEnd: swap panes[i] ↔ panes[j]           │
└────────────────────────────────────────────────┘
```

Three primary units, each independently testable:

| Unit | Responsibility | Inputs | Outputs |
|---|---|---|---|
| **Preset table** (`src/layout/presets.ts`) | Pure data: `LayoutId → LayoutPreset`. Knows nothing about React or panes. | `layoutId` | `LayoutPreset` |
| **Layout selector** (`src/layout/select.ts`) | Pure logic: default `layoutId` for N panes; alternatives for current N; legacy migration from `(rows, cols, paneCount)`. | N, optional legacy shape | `layoutId`, `layoutId[]` |
| **`<PaneLayoutEngine>`** (`src/components/PaneLayoutEngine.tsx`) | Renders a preset into nested `react-resizable-panels`, propagates resize, hosts the swap `DndContext`. | tab, panes, callbacks | React tree |

---

## Data model

```ts
// src/types.ts
type LayoutId =
  | '1'
  | '2V' | '2H'
  | '3C' | '3M' | '3T'
  | '4Q' | '4M'
  | '5T'
  | '6G'
  | '9G'

interface WorkspaceTab {
  id: string
  name: string
  accentColor?: string
  repoPath?: string
  layoutId: LayoutId
  panes: PaneNode[]                            // positional; panes[i] fills preset slot i
  splitRatios?: Record<string, number[]>       // optional weights keyed by node path
}
```

- `panes.length` may be less than `getPreset(layoutId).slotCount`. Missing slots render `<EmptyCell>` (clickable → opens `NewPaneDialog`).
- `panes.length > slotCount` is invalid for `layoutId !== '9G'`. The engine guards against it by promoting `layoutId` to the next preset with enough slots.
- `panes.length > 9` while `layoutId === '9G'`: the first 9 panes render in the grid; panes at index 9+ are *hidden* but kept in state (PTYs alive, focusable via `Cmd+1..9` is capped at 9, `Cmd+Shift+P` palette lists all). v1.1.x can later add an overflow strip; v1.1.0 ships with the simple cap to avoid blocking the milestone.
- `splitRatios` keys are node paths in the split tree: `'r'` (root), `'r/0'` (root's first child), `'r/1/0'`, etc. Resize handlers compute and write these.

### Preset structure

```ts
// src/layout/presets.ts
export type Split =
  | { kind: 'pane'; slot: number }
  | { kind: 'h' | 'v'; children: Split[] }

export interface LayoutPreset {
  id: LayoutId
  slotCount: number
  label: string
  icon: string         // inline SVG path data for the selector
  root: Split
}

export const PRESETS: Record<LayoutId, LayoutPreset> = {
  '1':  { id: '1',  slotCount: 1, label: 'Single',           icon: '…',
          root: { kind: 'pane', slot: 0 } },
  '2V': { id: '2V', slotCount: 2, label: 'Two columns',      icon: '…',
          root: { kind: 'h', children: [
            { kind: 'pane', slot: 0 }, { kind: 'pane', slot: 1 } ] } },
  '2H': { id: '2H', slotCount: 2, label: 'Two rows',         icon: '…',
          root: { kind: 'v', children: [
            { kind: 'pane', slot: 0 }, { kind: 'pane', slot: 1 } ] } },
  '3C': { id: '3C', slotCount: 3, label: 'Three columns',    icon: '…',
          root: { kind: 'h', children: [
            { kind: 'pane', slot: 0 }, { kind: 'pane', slot: 1 }, { kind: 'pane', slot: 2 } ] } },
  '3M': { id: '3M', slotCount: 3, label: 'Master + stack',   icon: '…',
          root: { kind: 'h', children: [
            { kind: 'pane', slot: 0 },
            { kind: 'v', children: [
              { kind: 'pane', slot: 1 }, { kind: 'pane', slot: 2 } ] } ] } },
  '3T': { id: '3T', slotCount: 3, label: 'Top split + bottom',
          icon: '…',
          root: { kind: 'v', children: [
            { kind: 'h', children: [
              { kind: 'pane', slot: 0 }, { kind: 'pane', slot: 1 } ] },
            { kind: 'pane', slot: 2 } ] } },
  '4Q': { id: '4Q', slotCount: 4, label: 'Quadrants',        icon: '…',
          root: { kind: 'v', children: [
            { kind: 'h', children: [
              { kind: 'pane', slot: 0 }, { kind: 'pane', slot: 1 } ] },
            { kind: 'h', children: [
              { kind: 'pane', slot: 2 }, { kind: 'pane', slot: 3 } ] } ] } },
  '4M': { id: '4M', slotCount: 4, label: 'Master + 3 stack',
          icon: '…',
          root: { kind: 'h', children: [
            { kind: 'pane', slot: 0 },
            { kind: 'v', children: [
              { kind: 'pane', slot: 1 }, { kind: 'pane', slot: 2 }, { kind: 'pane', slot: 3 } ] } ] } },
  '5T': { id: '5T', slotCount: 5, label: 'Three over two',
          icon: '…',
          root: { kind: 'v', children: [
            { kind: 'h', children: [
              { kind: 'pane', slot: 0 }, { kind: 'pane', slot: 1 }, { kind: 'pane', slot: 2 } ] },
            { kind: 'h', children: [
              { kind: 'pane', slot: 3 }, { kind: 'pane', slot: 4 } ] } ] } },
  '6G': { id: '6G', slotCount: 6, label: '3 × 2 grid',
          icon: '…',
          root: { kind: 'v', children: [
            { kind: 'h', children: [
              { kind: 'pane', slot: 0 }, { kind: 'pane', slot: 1 }, { kind: 'pane', slot: 2 } ] },
            { kind: 'h', children: [
              { kind: 'pane', slot: 3 }, { kind: 'pane', slot: 4 }, { kind: 'pane', slot: 5 } ] } ] } },
  '9G': { id: '9G', slotCount: 9, label: '3 × 3 grid',
          icon: '…',
          root: { kind: 'v', children: [
            { kind: 'h', children: Array.from({ length: 3 }, (_, c) => ({ kind: 'pane', slot: c }))   },
            { kind: 'h', children: Array.from({ length: 3 }, (_, c) => ({ kind: 'pane', slot: 3 + c })) },
            { kind: 'h', children: Array.from({ length: 3 }, (_, c) => ({ kind: 'pane', slot: 6 + c }))   } ] } },
}
```

### Default-per-N table

```ts
export function defaultLayoutFor(n: number): LayoutId {
  if (n <= 1) return '1'
  if (n === 2) return '2V'
  if (n === 3) return '3C'
  if (n === 4) return '4Q'
  if (n === 5) return '5T'
  if (n <= 6) return '6G'
  return '9G'  // 7..9 use 9G; 10+ also use 9G with extras hidden (see below)
}

export function alternativesFor(n: number): LayoutId[] {
  if (n === 2) return ['2V', '2H']
  if (n === 3) return ['3C', '3M', '3T']
  if (n === 4) return ['4Q', '4M']
  return []  // 1, 5+, no alternatives initially
}
```

---

## Render

`<PaneLayoutEngine>` replaces the current `<PanelGroup>` in `App.tsx`.

```ts
function renderSplit(
  split: Split,
  path: string,                          // 'r', 'r/0', 'r/0/1', etc.
  panes: PaneNode[],
  splitRatios: Record<string, number[]>,
  onResize: (path: string, sizes: number[]) => void,
  onEmptyClick: (slot: number) => void,
): ReactNode {
  if (split.kind === 'pane') {
    const pane = panes[split.slot]
    if (!pane) return <EmptyCell onClick={() => onEmptyClick(split.slot)} />
    return pane.aiType === 'browser'
      ? <BrowserCell key={pane.id} pane={pane} … />
      : <TerminalPane key={pane.id} pane={pane} … />
  }

  const ratios = splitRatios[path] ?? equalSizes(split.children.length)
  const direction = split.kind === 'h' ? 'horizontal' : 'vertical'

  return (
    <PanelGroup
      direction={direction}
      onLayout={sizes => onResize(path, sizes)}
    >
      {split.children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <PanelResizeHandle className={`resize-handle resize-handle--${split.kind === 'h' ? 'col' : 'row'}`} />}
          <Panel defaultSize={ratios[i]} minSize={5}>
            {renderSplit(child, `${path}/${i}`, panes, splitRatios, onResize, onEmptyClick)}
          </Panel>
        </Fragment>
      ))}
    </PanelGroup>
  )
}
```

Key invariants:
- `<TerminalPane key={pane.id}>` → React reconciler matches by id across layout changes. Moving a pane between slots, switching `layoutId`, or resizing never remounts the component. **PTYs survive.**
- `react-resizable-panels` enforces its container; nothing positioned absolutely; nothing can escape the viewport.
- Empty slots are first-class citizens — they render a clickable affordance and never crash the engine.

---

## Drag & swap

```ts
<DndContext
  sensors={[useSensor(PointerSensor, { activationConstraint: { distance: 6 } })]}
  collisionDetection={closestCenter}
  onDragEnd={({ active, over }) => {
    if (!over || active.id === over.id) return
    const from = tab.panes.findIndex(p => p.id === active.id)
    const to = tab.panes.findIndex(p => p.id === over.id)
    if (from < 0 || to < 0) return
    updateActiveTab(t => {
      const next = [...t.panes]
      ;[next[from], next[to]] = [next[to], next[from]]
      return { ...t, panes: next }
    })
  }}
>
  <SortableContext items={tab.panes.map(p => p.id)}>
    <PaneLayoutEngine … />
  </SortableContext>
</DndContext>
```

`TerminalPane`/`BrowserCell` consume `useSortable({ id: pane.id })` and apply `listeners` + `attributes` to a header-only drag handle (`.pane-drag-handle` inside `.pane-header`). Clicks inside the terminal or on header buttons (close, color picker, restart, etc.) are not drag triggers thanks to the 6 px activation constraint and the handle scoping.

Visual feedback:
- Source: `opacity: 0.3` while dragging.
- Target (over): blue outline (`outline: 2px solid var(--raven-blue)66; outline-offset: -2px`).
- DragOverlay shows a small ghost with the pane header label (already implemented in v1.0.x, kept).

---

## Layout selector

UI: a small mosaics-icon button anchored to the **top-right of the workspace**, opens a popover on click.

Popover content:
- Header: "Layout — N panes".
- Grid of mini-mockups (SVG icons from each preset) for `alternativesFor(panes.length)`.
- Current preset is highlighted (blue border).
- Click a mockup → `setLayoutId(id)`, popover closes.

Keyboard: `Ctrl/Cmd + L` toggles the popover when focus is in the workspace.

When `panes.length` changes (add/remove), the engine recomputes the default:
- If current `layoutId.slotCount === panes.length` and `layoutId` is in `alternativesFor(panes.length)` → keep current (user-chosen alternative is sticky).
- Else → apply `defaultLayoutFor(panes.length)`.

This means: pick "3M" while you have 3 panes, then add a 4th, layout switches to `4Q` (default). Remove the 4th, layout snaps back to `3C` (default) — **not** `3M`, since we don't remember per-N selections. (Iteration v1.1.x can add stickiness if requested.)

---

## Drop external (worktree → grid)

Already implemented earlier in this branch; **kept** with one adjustment.

- `WorktreesSection` items: `draggable` with `dataTransfer.setData('application/x-raven-worktree-path', wt.repoPath)`.
- The workspace `<div>` listens for `dragover`/`drop`. On drop with that MIME:
  - `setAddingPane({ worktreePath: path })` — opens `NewPaneDialog` preloaded with the worktree as `cwd`.
  - Dialog confirmation calls `addPane()` → appends to `tab.panes` → engine promotes `layoutId` if needed.

The drop target is the entire workspace surface (not individual cells). A dashed blue outline appears on the workspace while a valid drag is hovering.

---

## Persistence & migration

### Save format (v3)

```jsonc
{
  "tabs": [
    {
      "id": "tab-…",
      "name": "Workspace",
      "accentColor": "#0066FF",
      "repoPath": "…",
      "layoutId": "3C",
      "splitRatios": { "r": [33, 34, 33] },
      "panes": [ /* SessionPane[] — same shape as v1.0.x cells, no nulls */ ]
    }
  ],
  "activeTabId": "…"
}
```

### Load

```ts
function migrateTab(raw: any): WorkspaceTab {
  // v3 (new): has layoutId + panes
  if (raw.layoutId && Array.isArray(raw.panes)) {
    return {
      id: raw.id,
      name: raw.name,
      accentColor: raw.accentColor,
      repoPath: raw.repoPath,
      layoutId: raw.layoutId as LayoutId,
      panes: raw.panes.map(sessionToPane),
      splitRatios: raw.splitRatios ?? {},
    }
  }

  // v2 legacy (tabs with layout/cells)
  if (raw.layout && Array.isArray(raw.cells)) {
    const livePanes = raw.cells
      .filter((c: any) => c != null)
      .map(sessionToPane)
    const layoutId = mapLegacyToPreset(raw.layout.rows, raw.layout.cols, livePanes.length)
    return {
      id: raw.id, name: raw.name, accentColor: raw.accentColor, repoPath: raw.repoPath,
      layoutId,
      panes: livePanes,
      splitRatios: tryMapLegacyRatios(raw, layoutId),
    }
  }

  // Fallback: empty
  return { id: raw.id ?? generateTabId(), name: raw.name ?? 'Workspace', layoutId: '1', panes: [] }
}

function mapLegacyToPreset(rows: number, cols: number, n: number): LayoutId {
  // 1×1 → '1', 1×2 → '2V', 2×1 → '2H', 1×3 → '3C', 2×2 → '4Q', 2×3 → '6G', 3×3 → '9G'
  const map: Record<string, LayoutId> = {
    '1x1': '1', '1x2': '2V', '2x1': '2H', '1x3': '3C', '2x2': '4Q', '2x3': '6G', '3x3': '9G',
  }
  return map[`${rows}x${cols}`] ?? defaultLayoutFor(n)
}
```

`tryMapLegacyRatios` is best-effort: if the legacy `colSizes[0]` matches a horizontal split path in the new preset, copy it; otherwise leave `splitRatios` empty so the preset falls back to equal weights.

v1 legacy (flat `layout + cells` without `tabs`) → wrap into a single tab and apply v2 migration.

---

## Cleanup of in-flight changes

Files reverted to their `v1.0.1` state (except where the cleanup itself is desirable):
- `src/hooks/useFreeGrid.ts` → **delete**.
- `src/App.tsx` → drop `react-grid-layout` imports, drop the `GridLayout` JSX, restore `<DndContext>` for swap, use the new `<PaneLayoutEngine>`.
- `src/main.tsx` → drop the `react-grid-layout/css/styles.css` and `react-resizable/css/styles.css` imports.
- `src/styles/global.css` → remove the `.react-grid-*` block I added, restore the `.grid-workspace [data-panel]` flex rule.
- `package.json` → keep `react-grid-layout` for now (uninstall in a follow-up commit once we're sure nothing imports it).

Files that **stay** as I changed them:
- `src/components/Sidebar.tsx` → `LayoutPicker` stays removed; the new selector lives in the workspace, not the sidebar.
- `src/components/WorktreesSection.tsx` → items stay `draggable` (the drop logic in the new engine consumes it).
- `src/components/TerminalPane.tsx` → `cellId`/`isDragging` props stay removed; `useSortable({ id: pane.id })` returns.
- `src/components/BrowserCell.tsx` → `cellId` stays removed; `data-pane-id={pane.id}` stays.
- `src/components/PaneHeader.tsx` → `dragHandleProps` returns (used by `useSortable`).
- `src/components/TabBar.tsx` → `tabActivity: Map<string, Set<string>>` stays (now keyed by pane id, not numeric index).
- `electron/raven-home.ts` → `userHome()` export stays (was a preexisting build break, now fixed).

---

## Testing

Pure-function tests in `src/layout/__tests__/`:

```ts
describe('preset table', () => {
  it('every preset has a unique id matching its key', () => { … })
  it('every preset.root references slots 0..slotCount-1 exactly once', () => { … })
})

describe('defaultLayoutFor', () => {
  test.each([
    [1, '1'], [2, '2V'], [3, '3C'], [4, '4Q'], [5, '5T'], [6, '6G'], [7, '9G'], [9, '9G'], [12, '9G'],
  ])('n=%i → %s', (n, expected) => { … })
})

describe('mapLegacyToPreset', () => {
  test.each([
    [[1,1,1], '1'], [[1,2,2], '2V'], [[2,1,2], '2H'],
    [[2,2,4], '4Q'], [[2,2,3], '4Q'],   // 3 live panes in a 2×2 → '4Q', leaves one empty slot
    [[3,3,9], '9G'],
  ])('rows=%s cols=%s n=%s → %s', ([r,c,n], expected) => { … })
})

describe('swap', () => {
  it('swaps two panes by index without touching their ids', () => { … })
})
```

Integration smoke (manual, not automated):
1. Launch dev. Empty state → "+ New Pane" → confirm dialog → pane fills the screen.
2. Click "+ New Pane" three more times. Verify defaults: 2V → 3C → 4Q.
3. Open the layout selector at N=3, switch to `3M`, then to `3T`, then back to `3C`.
4. Drag the header of pane 1 onto pane 3 → swap completes, neither PTY restarts (their prompt and history are preserved).
5. Drag a resize handle to change a split ratio. Reload the app — ratio persists.
6. Drag a worktree from the sidebar onto the workspace → dialog opens with the worktree preloaded → confirm → new pane joins.
7. Close panes one by one; verify defaults snap back (4Q → 3C → 2V → 1).
8. Verify no pane is ever rendered outside the workspace bounds.

Existing tests (`electron/__tests__/*`, e2e) are not affected.

---

## Out of scope (deferred)

- Per-N sticky alternative selection (remember "user picked 3M last time at N=3").
- Custom user-defined presets.
- Animated transitions between layouts.
- Drag-and-drop a pane *into* another tab (cross-tab moves).
- Drop a worktree directly onto a specific pane (currently always opens the dialog regardless of where you drop).
- A "broadcast to subset" feature where layout positions imply broadcast groups.
- Resize ratios that survive layout switches (currently a switch discards `splitRatios` since paths change).

---

## Open questions

None as of this writing. All branching decisions resolved during brainstorming (tiling strict; swap drag; resizable splits; defaults table; worktree drop opens dialog).
