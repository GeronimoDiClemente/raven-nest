# Per-cell pane resize — design

**Status**: approved (brainstorming 2026-08-24) — pending implementation plan
**Branch**: `feat/pane-resize-per-cell` (base: `main` @ `5015a39`, post-v1.5.0)
**Target release**: `v1.6.0`

## Problem

Reported by Gero on 2026-08-24: **with four terminals in a grid, dragging the
divider under the top-left pane moves both top panes.** He expects all four to
be sizable independently.

This is not a bug. It is what the model can express. `4Q` is:

```
v( h(pane0, pane1),
   h(pane2, pane3) )
```

The horizontal divider belongs to the **root** `v` group, so it separates *row
from row*, never *pane from pane*. The same holds for every preset with nested
groups — `6G`, `9G`, `12G`, `3M`, and all the master+stack variants.

### The underlying constraint

In a split tree, one axis is always coupled. Transposing `4Q` to
`h( v(0,2), v(1,3) )` frees the vertical dividers and immediately couples the
horizontal ones — the complaint just moves to the other axis. **To free both
axes you have to leave the tree.**

A layout where all four cells resize independently is a *rectangular
dissection*, and not every dissection is representable as a split tree. `4Q`
with all four dividers independent is precisely one that isn't.

### Relationship to the v1.1 non-goal

`docs/superpowers/specs/2026-05-13-pane-layout-design.md` lists *free
positioning* as an explicit non-goal, after an attempt with `react-grid-layout`
let panes be dragged outside the viewport.

**This is not that.** Nothing floats, nothing overlaps, and there are no gaps.
The pane set always tiles the workspace exactly. The only thing that changes is
that divider segments stop being forced to span the full width or height.

## Goal

Every pane's edges are draggable independently, subject only to geometry: a
divider segment moves the minimal set of panes that share it. Everything else
about the workspace — presets, drag-to-swap, the Hub, PTY/Monaco/browser
survival — behaves exactly as it does today.

## Decisions (both chosen by Gero)

1. **Real per-cell freedom** — a rects engine, not a patch on one axis.
2. **Opening/closing a pane preserves the arrangement.** A new pane splits the
   largest-area pane; closing one lets its neighbours stretch into the vacated
   space. The layout detaches from the preset the moment you touch it.

## Data model

```ts
// WorkspaceTab
paneRects?: Rect[]   // { x, y, w, h } in %, index === slot, parallel to panes[]
```

`layoutId` and `splitRatios` **stay**. When `paneRects` is absent the rects are
derived from the preset:

```ts
rectsFromSplit(preset.root, splitRatios) -> Rect[]
```

This buys three things for free:

- The 30 presets keep working without being rewritten.
- Old sessions and workspaces load unchanged (no migration).
- **"Reset layout" is `paneRects = undefined`.**

`paneRects` is written on the first divider drag and from then on is the source
of truth. Picking a preset from the selector clears it.

## The pure engine — `src/layout/rects.ts`

```ts
rectsFromSplit(split: Split, ratios: Record<string, number[]>): Rect[]
edgesOf(rects: Rect[]): Edge[]
resizeEdge(rects: Rect[], edge: Edge, deltaPct: number): Rect[]
splitLargest(rects: Rect[]): Rect[]
removeRect(rects: Rect[], slot: number): Rect[]
```

### The rule that makes it work

All of the difficulty lives in `edgesOf`. A draggable handle is **the minimal
set of panes that must move together**, computed as the transitive closure of:

> pane P belongs to this edge if it touches the same coordinate **and** its
> perpendicular range overlaps a pane already in the set.

Worked cases:

- **2×2**: yields 2 vertical handles and 2 horizontal handles, all independent.
  Dragging the bottom edge of pane A moves A and C only — B and D are untouched.
  This is exactly the reported complaint, fixed.
- **One wide pane on top of two below**: the closure pulls in all three. There is
  no alternative — a single rect cannot have its bottom edge at two different
  heights. The grouping is forced by geometry, not by a tree, and that is the
  distinction that matters.

`resizeEdge` clamps against a per-pane minimum (today this is `minSize={8}` on
`<Panel>`; it becomes an explicit clamp) and is a pure transform, so it is
exhaustively testable.

## Rendering — `PaneLayoutEngine`

The nested `PanelGroup`/`Panel`/`PanelResizeHandle` tree is replaced by:

- one absolutely-positioned slot per pane, in `%` — `left/top/width/height`
- one thin div per handle from `edgesOf`, with pointer handlers

**The reparenting is not touched.** Panes keep living in their own host div,
mounted once via `createPortal`, moved between slots with `appendChild` in
`useLayoutEffect` (restoring focus). That mechanism is the only reason PTYs,
Monaco models and the browser's `WebContentsView` survive a reorder — see the
comment block at the top of `PaneLayoutEngine.tsx`. Slots stop being `<Panel>`
children and become absolutely-positioned divs; the host and the `appendChild`
move are unchanged.

`beginResizeSuppression()` / `endResizeSuppression()` from
`lib/pane-resize-gate.ts` are reused on drag start/end, so the PTY is not fed
the dozens of intermediate sizes a drag passes through — the same contract the
`PanelResizeHandle` `onDragging` callback has today.

`react-resizable-panels` leaves the workspace.

## Out of scope

Unchanged by this work: drag-to-swap (`swap.ts`), the Hub (same component,
inherits the behaviour), the pane-type view filter, and the layout selector.

## Testing

The engine is pure, so the interesting cases are all unit tests.

- **Coverage invariant**: the rects tile the workspace exactly — no gaps, no
  overlaps, total area 100%. Asserted over all 30 presets, and again after N
  randomised `resizeEdge` calls.
- **The reported case**: in `4Q`, dragging pane 0's bottom edge leaves panes 1
  and 3 byte-identical.
- **The forced-grouping case**: wide-over-two moves all three, and the result
  still satisfies the coverage invariant.
- **`splitLargest` / `removeRect`** preserve the invariant.
- **Reparenting**: `pane-remount-nested.test.tsx` must stay green — it is the
  regression guard for the portal/appendChild mechanism.

## Risks

- **Minimum size** is enforced by hand now, where `minSize={8}` used to do it.
  Degenerate panes are what fed the pty the `15x30` sizes chased down in the
  banner-duplication hunt, so the clamp needs a test.
- **`WebContentsView` positioning.** The browser pane is a native layer
  positioned from DOM measurements, not a DOM child. Absolute slots must be
  verified to still produce correct bounds — the reposition tick already reads
  the slot rect, but this is the one part unit tests cannot cover.
