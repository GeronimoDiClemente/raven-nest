# Pane Layout Engine v1.1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-flight `react-grid-layout` free-grid attempt with a tiling layout engine: per-N default presets, user-switchable alternatives, drag-and-drop swap that keeps PTYs alive, resizable splits, and worktree-drop-to-spawn — all bounded to the workspace viewport.

**Architecture:** Three units (pure preset table, pure selector logic, React engine component) wired through a `<DndContext>` for swap. Built on `react-resizable-panels` (already in use in v1.0.x), with `@dnd-kit/core` reused from `TabBar`. Spec: `docs/superpowers/specs/2026-05-13-pane-layout-design.md`.

**Tech Stack:** React 18, TypeScript, `react-resizable-panels`, `@dnd-kit/core` + `@dnd-kit/sortable`, Vitest for unit tests, Electron + Vite for app shell.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/types.ts` | modify | Add `LayoutId`; replace `WorkspaceTab.layout/cells/colSizes/rowSizes` with `layoutId/panes/splitRatios`; update `SessionData` shape; remove `WorkspaceCell` and `SessionCell` from earlier attempt |
| `src/layout/presets.ts` | create | `PRESETS` table, `Split` type, `LayoutPreset`, `getPreset()` |
| `src/layout/select.ts` | create | `defaultLayoutFor(n)`, `alternativesFor(n)`, `mapLegacyToPreset(rows, cols, n)` |
| `src/layout/swap.ts` | create | `swap<T>(arr, i, j)` helper |
| `src/__tests__/layout/presets.test.ts` | create | Validates preset shape invariants |
| `src/__tests__/layout/select.test.ts` | create | Default/alternatives/legacy migration tests |
| `src/__tests__/layout/swap.test.ts` | create | Swap immutability + identity |
| `src/components/PaneLayoutEngine.tsx` | create | Renders preset tree into nested `<PanelGroup>` / `<Panel>` / `<PanelResizeHandle>` |
| `src/components/LayoutSelector.tsx` | create | Top-right popover with mini-mockups of alternatives |
| `src/components/TerminalPane.tsx` | modify | Restore `useSortable({ id: pane.id })` + `dragHandleProps` |
| `src/components/BrowserCell.tsx` | modify | Add `useSortable({ id: pane.id })` (browser panes also need to be drag sources) |
| `src/components/PaneHeader.tsx` | modify | Restore `dragHandleProps` prop |
| `src/components/CommandPalette.tsx` | modify | Change `tab.cells.filter(Boolean).length` → `tab.panes.length` |
| `src/App.tsx` | modify | Replace `<GridLayout>` with `<DndContext> + <PaneLayoutEngine>`; rewrite `addPane`/`removePane`/`openBrowserCell` to operate on `tab.panes`; rewrite session load/save; remove `useFreeGrid` usage |
| `src/hooks/useFreeGrid.ts` | delete | Was the free-grid hook; obsolete |
| `src/main.tsx` | modify | Remove `react-grid-layout/css/styles.css` and `react-resizable/css/styles.css` imports |
| `src/styles/global.css` | modify | Remove `.react-grid-*` rules; restore the v1.0.x `.grid-workspace [data-panel]` flex rule |
| `package.json` | modify | Remove `react-grid-layout` and `@types/react-grid-layout` from deps |
| `package-lock.json` | regenerate | `npm uninstall` will update it |

---

## Conventions

- **Branch:** `feat/free-grid` (do not create new branches; this plan finishes the work-in-progress).
- **Tests run:** `npx vitest run src/__tests__/layout` per task; full suite at the end.
- **Typecheck:** `npx tsc --noEmit -p tsconfig.web.json`. Baseline before this plan is **18 preexisting errors**; the plan must not increase that number.
- **Commits:** one per task. Format: `feat(layout): …` or `chore(grid): …`, with a single `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.

---

## Task 0: Revert the free-grid attempt

**Why first:** The in-flight `useFreeGrid` + `react-grid-layout` JSX in `App.tsx` is mutually exclusive with the new engine. Reverting first gives a clean baseline that compiles, and keeps later diffs reviewable.

**Files:**
- Delete: `src/hooks/useFreeGrid.ts`
- Modify: `src/App.tsx` — replace the body with the v1.0.1 logic from `git show v1.0.1:src/App.tsx`, but keep three improvements: (a) `data-pane-id` on cells, (b) workspace `onDrop` accepting the worktree MIME, (c) `setAddingPane({ worktreePath })` flow.
- Modify: `src/main.tsx` — remove the two RGL CSS imports.
- Modify: `src/styles/global.css` — delete the `.react-grid-*` block I added; restore the `.grid-workspace [data-panel]` rule from v1.0.1.
- Modify: `src/types.ts` — remove `WorkspaceCell`, `SessionCell`, `GRID_COLS`, `findFreeSlot`, `migrateLegacyGrid` (they belong to the free-grid attempt); restore `WorkspaceTab` to the v1.0.1 shape *temporarily* (Task 1 will replace it with the new shape).

- [ ] **Step 1: Inspect the v1.0.1 App.tsx to know the target shape**

Run: `git show v1.0.1:src/App.tsx | head -200`
Expected: shows the PanelGroup-based render that you'll restore.

- [ ] **Step 2: Restore `src/App.tsx` from v1.0.1**

```bash
git checkout v1.0.1 -- src/App.tsx
```

Expected: working tree shows `src/App.tsx` reset.

- [ ] **Step 3: Restore `src/types.ts` from v1.0.1**

```bash
git checkout v1.0.1 -- src/types.ts
```

- [ ] **Step 4: Restore `src/main.tsx` from v1.0.1**

```bash
git checkout v1.0.1 -- src/main.tsx
```

- [ ] **Step 5: Restore `src/styles/global.css` from v1.0.1**

```bash
git checkout v1.0.1 -- src/styles/global.css
```

- [ ] **Step 6: Restore the touched components from v1.0.1 too — they'll be re-modified later**

```bash
git checkout v1.0.1 -- src/components/TerminalPane.tsx src/components/BrowserCell.tsx src/components/PaneHeader.tsx src/components/Sidebar.tsx src/components/TabBar.tsx src/components/CommandPalette.tsx src/components/WorktreesSection.tsx
```

- [ ] **Step 7: Delete the `useFreeGrid` hook**

```bash
rm src/hooks/useFreeGrid.ts
```

- [ ] **Step 8: Verify the typecheck error count is back to baseline**

Run: `npx tsc --noEmit -p tsconfig.web.json 2>&1 | wc -l`
Expected: `18` (preexisting errors, no new ones).

- [ ] **Step 9: Verify the renderer builds**

Run: `npm run build 2>&1 | tail -5`
Expected: `built in <Ns>` with no errors.

- [ ] **Step 10: Commit the revert**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(grid): revert free-grid attempt to clean baseline

Removes the react-grid-layout-based PaneLayoutEngine attempt and
restores the v1.0.1 PanelGroup-based render. New tiling engine lands in
subsequent commits following docs/superpowers/specs/2026-05-13-pane-layout-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: Add new types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Append `LayoutId` and update `WorkspaceTab` / `SessionData`**

Read `src/types.ts` to find the current `WorkspaceTab` and `SessionData` interfaces, then apply this edit:

```ts
// Add near other type aliases:
export type LayoutId =
  | '1'
  | '2V' | '2H'
  | '3C' | '3M' | '3T'
  | '4Q' | '4M'
  | '5T'
  | '6G'
  | '9G'

// Replace WorkspaceTab with:
export interface WorkspaceTab {
  id: string
  name: string
  accentColor?: string
  repoPath?: string
  layoutId: LayoutId
  panes: PaneNode[]                            // positional: panes[i] fills preset slot i
  splitRatios?: Record<string, number[]>       // weights keyed by tree path
}

// Replace the tabs entries in SessionData with:
export interface SessionData {
  tabs?: Array<{
    id: string
    name: string
    accentColor?: string
    repoPath?: string
    // v3 new
    layoutId?: LayoutId
    panes?: SessionPane[]
    splitRatios?: Record<string, number[]>
    // v2 legacy (kept optional for migration)
    layout?: GridLayout
    cells?: (SessionPane | null)[]
    colSizes?: number[][]
    rowSizes?: number[]
  }>
  activeTabId?: string
  // v1 legacy
  layout?: GridLayout
  cells?: (SessionPane | null)[]
}
```

- [ ] **Step 2: Verify typecheck breaks only in known consumers (App.tsx, CommandPalette)**

Run: `npx tsc --noEmit -p tsconfig.web.json 2>&1 | grep -E "src/(App|components/CommandPalette)" | head`
Expected: ~5-10 errors all in those two files (no other surprises).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "$(cat <<'EOF'
feat(layout): add LayoutId and v3 WorkspaceTab/SessionData shape

WorkspaceTab now has layoutId + panes + splitRatios. SessionData tabs
keep v2 fields optional so a load can migrate. v1.0.1 consumers
(App.tsx, CommandPalette) still expect the old shape and will be
updated in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Preset table

**Files:**
- Create: `src/layout/presets.ts`
- Create: `src/__tests__/layout/presets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/layout/presets.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PRESETS, getPreset, type LayoutPreset, type Split } from '../../layout/presets'

function collectSlots(split: Split, out: number[] = []): number[] {
  if (split.kind === 'pane') { out.push(split.slot); return out }
  for (const c of split.children) collectSlots(c, out)
  return out
}

describe('PRESETS', () => {
  it('keys match preset ids', () => {
    for (const [key, preset] of Object.entries(PRESETS)) {
      expect(preset.id).toBe(key)
    }
  })

  it('every preset references slots 0..slotCount-1 exactly once', () => {
    for (const preset of Object.values(PRESETS) as LayoutPreset[]) {
      const slots = collectSlots(preset.root).sort((a, b) => a - b)
      const expected = Array.from({ length: preset.slotCount }, (_, i) => i)
      expect(slots).toEqual(expected)
    }
  })

  it('every preset has a non-empty label and icon', () => {
    for (const preset of Object.values(PRESETS) as LayoutPreset[]) {
      expect(preset.label.length).toBeGreaterThan(0)
      expect(preset.icon.length).toBeGreaterThan(0)
    }
  })
})

describe('getPreset', () => {
  it('returns the preset for a known id', () => {
    expect(getPreset('3C').slotCount).toBe(3)
  })

  it('throws for unknown id', () => {
    // @ts-expect-error invalid id
    expect(() => getPreset('99X')).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/layout/presets.test.ts`
Expected: FAIL with module not found (`src/layout/presets.ts`).

- [ ] **Step 3: Implement the preset table**

Create `src/layout/presets.ts`:

```ts
import type { LayoutId } from '../types'

export type Split =
  | { kind: 'pane'; slot: number }
  | { kind: 'h' | 'v'; children: Split[] }

export interface LayoutPreset {
  id: LayoutId
  slotCount: number
  label: string
  icon: string         // inline SVG path data
  root: Split
}

const pane = (slot: number): Split => ({ kind: 'pane', slot })
const h = (...children: Split[]): Split => ({ kind: 'h', children })
const v = (...children: Split[]): Split => ({ kind: 'v', children })

// SVG path data for 16x16 mosaics. Used by LayoutSelector mini-mockups.
const ICONS: Record<LayoutId, string> = {
  '1':  'M2 2h12v12H2z',
  '2V': 'M2 2h5v12H2z M9 2h5v12H9z',
  '2H': 'M2 2h12v5H2z M2 9h12v5H2z',
  '3C': 'M2 2h3.3v12H2z M6.3 2h3.4v12H6.3z M10.7 2h3.3v12h-3.3z',
  '3M': 'M2 2h5v12H2z M9 2h5v5H9z M9 9h5v5H9z',
  '3T': 'M2 2h5v5H2z M9 2h5v5H9z M2 9h12v5H2z',
  '4Q': 'M2 2h5v5H2z M9 2h5v5H9z M2 9h5v5H2z M9 9h5v5H9z',
  '4M': 'M2 2h5v12H2z M9 2h5v3.3H9z M9 6.3h5v3.4H9z M9 10.7h5v3.3H9z',
  '5T': 'M2 2h3.3v5H2z M6.3 2h3.4v5H6.3z M10.7 2h3.3v5h-3.3z M2 9h5v5H2z M9 9h5v5H9z',
  '6G': 'M2 2h3.3v5H2z M6.3 2h3.4v5H6.3z M10.7 2h3.3v5h-3.3z M2 9h3.3v5H2z M6.3 9h3.4v5H6.3z M10.7 9h3.3v5h-3.3z',
  '9G': 'M2 2h3.3v3.3H2z M6.3 2h3.4v3.3H6.3z M10.7 2h3.3v3.3h-3.3z M2 6.3h3.3v3.4H2z M6.3 6.3h3.4v3.4H6.3z M10.7 6.3h3.3v3.4h-3.3z M2 10.7h3.3v3.3H2z M6.3 10.7h3.4v3.3H6.3z M10.7 10.7h3.3v3.3h-3.3z',
}

export const PRESETS: Record<LayoutId, LayoutPreset> = {
  '1':  { id: '1',  slotCount: 1, label: 'Single',                   icon: ICONS['1'],  root: pane(0) },
  '2V': { id: '2V', slotCount: 2, label: 'Two columns',              icon: ICONS['2V'], root: h(pane(0), pane(1)) },
  '2H': { id: '2H', slotCount: 2, label: 'Two rows',                 icon: ICONS['2H'], root: v(pane(0), pane(1)) },
  '3C': { id: '3C', slotCount: 3, label: 'Three columns',            icon: ICONS['3C'], root: h(pane(0), pane(1), pane(2)) },
  '3M': { id: '3M', slotCount: 3, label: 'Master + stack',           icon: ICONS['3M'], root: h(pane(0), v(pane(1), pane(2))) },
  '3T': { id: '3T', slotCount: 3, label: 'Top split + bottom',       icon: ICONS['3T'], root: v(h(pane(0), pane(1)), pane(2)) },
  '4Q': { id: '4Q', slotCount: 4, label: 'Quadrants',                icon: ICONS['4Q'], root: v(h(pane(0), pane(1)), h(pane(2), pane(3))) },
  '4M': { id: '4M', slotCount: 4, label: 'Master + 3 stack',         icon: ICONS['4M'], root: h(pane(0), v(pane(1), pane(2), pane(3))) },
  '5T': { id: '5T', slotCount: 5, label: 'Three over two',           icon: ICONS['5T'], root: v(h(pane(0), pane(1), pane(2)), h(pane(3), pane(4))) },
  '6G': { id: '6G', slotCount: 6, label: '3 × 2 grid',               icon: ICONS['6G'], root: v(h(pane(0), pane(1), pane(2)), h(pane(3), pane(4), pane(5))) },
  '9G': { id: '9G', slotCount: 9, label: '3 × 3 grid',               icon: ICONS['9G'], root: v(
    h(pane(0), pane(1), pane(2)),
    h(pane(3), pane(4), pane(5)),
    h(pane(6), pane(7), pane(8)),
  ) },
}

export function getPreset(id: LayoutId): LayoutPreset {
  const preset = PRESETS[id]
  if (!preset) throw new Error(`unknown layout id: ${id}`)
  return preset
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/layout/presets.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/layout/presets.ts src/__tests__/layout/presets.test.ts
git commit -m "$(cat <<'EOF'
feat(layout): preset table with 11 tiling layouts

Pure data: PRESETS map keyed by LayoutId. Each preset declares slotCount,
label, mini-mockup SVG icon, and a Split tree of horizontal/vertical
nodes whose leaves reference slot indices. Tests assert each preset
references its slots 0..N-1 exactly once.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Selector logic (defaults + alternatives)

**Files:**
- Create: `src/layout/select.ts`
- Create: `src/__tests__/layout/select.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/layout/select.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { defaultLayoutFor, alternativesFor, mapLegacyToPreset } from '../../layout/select'

describe('defaultLayoutFor', () => {
  it.each([
    [0, '1'], [1, '1'], [2, '2V'], [3, '3C'], [4, '4Q'],
    [5, '5T'], [6, '6G'], [7, '9G'], [9, '9G'], [12, '9G'],
  ] as const)('n=%i → %s', (n, expected) => {
    expect(defaultLayoutFor(n)).toBe(expected)
  })
})

describe('alternativesFor', () => {
  it('returns multiple options for N=2/3/4', () => {
    expect(alternativesFor(2)).toEqual(['2V', '2H'])
    expect(alternativesFor(3)).toEqual(['3C', '3M', '3T'])
    expect(alternativesFor(4)).toEqual(['4Q', '4M'])
  })

  it('returns just the default for N=1 and N>=5', () => {
    expect(alternativesFor(1)).toEqual(['1'])
    expect(alternativesFor(5)).toEqual(['5T'])
    expect(alternativesFor(6)).toEqual(['6G'])
    expect(alternativesFor(9)).toEqual(['9G'])
  })
})

describe('mapLegacyToPreset', () => {
  it.each([
    [1, 1, 1, '1'],
    [1, 2, 2, '2V'],
    [2, 1, 2, '2H'],
    [1, 3, 3, '3C'],
    [2, 2, 4, '4Q'],
    [2, 2, 3, '4Q'],   // 3 live panes in 2×2 — one empty slot stays
    [2, 3, 6, '6G'],
    [3, 3, 9, '9G'],
  ])('rows=%i cols=%i n=%i → %s', (rows, cols, n, expected) => {
    expect(mapLegacyToPreset(rows, cols, n)).toBe(expected)
  })

  it('falls back to defaultLayoutFor when shape is non-standard', () => {
    expect(mapLegacyToPreset(5, 7, 5)).toBe('5T')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/layout/select.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement**

Create `src/layout/select.ts`:

```ts
import type { LayoutId } from '../types'

export function defaultLayoutFor(n: number): LayoutId {
  if (n <= 1) return '1'
  if (n === 2) return '2V'
  if (n === 3) return '3C'
  if (n === 4) return '4Q'
  if (n === 5) return '5T'
  if (n === 6) return '6G'
  return '9G'
}

export function alternativesFor(n: number): LayoutId[] {
  if (n === 2) return ['2V', '2H']
  if (n === 3) return ['3C', '3M', '3T']
  if (n === 4) return ['4Q', '4M']
  return [defaultLayoutFor(n)]
}

const LEGACY_MAP: Record<string, LayoutId> = {
  '1x1': '1',
  '1x2': '2V',
  '2x1': '2H',
  '1x3': '3C',
  '2x2': '4Q',
  '2x3': '6G',
  '3x2': '6G',
  '3x3': '9G',
}

export function mapLegacyToPreset(rows: number, cols: number, n: number): LayoutId {
  const hit = LEGACY_MAP[`${rows}x${cols}`]
  if (hit) return hit
  return defaultLayoutFor(n)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/layout/select.test.ts`
Expected: 3 describes, all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/layout/select.ts src/__tests__/layout/select.test.ts
git commit -m "$(cat <<'EOF'
feat(layout): defaultLayoutFor + alternativesFor + mapLegacyToPreset

Pure functions that drive per-N default layout selection and migration
from v1.0.x rows×cols grids. defaultLayoutFor maps 0→'1', 2→'2V',
3→'3C', 4→'4Q', 5→'5T', 6→'6G', 7+→'9G'. alternativesFor returns
multiple options for N=2/3/4. Legacy shapes 1×1/1×2/2×1/1×3/2×2/2×3/
3×2/3×3 map directly; everything else falls back to defaultLayoutFor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Swap helper

**Files:**
- Create: `src/layout/swap.ts`
- Create: `src/__tests__/layout/swap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/layout/swap.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { swap } from '../../layout/swap'

describe('swap', () => {
  it('swaps two elements by index', () => {
    expect(swap([1, 2, 3], 0, 2)).toEqual([3, 2, 1])
  })

  it('returns a new array (does not mutate)', () => {
    const original = [1, 2, 3]
    const result = swap(original, 0, 1)
    expect(result).not.toBe(original)
    expect(original).toEqual([1, 2, 3])
  })

  it('is a no-op when i === j', () => {
    expect(swap([1, 2, 3], 1, 1)).toEqual([1, 2, 3])
  })

  it('returns the original array when an index is out of bounds', () => {
    expect(swap([1, 2, 3], 0, 5)).toEqual([1, 2, 3])
    expect(swap([1, 2, 3], -1, 1)).toEqual([1, 2, 3])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/layout/swap.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/layout/swap.ts`:

```ts
export function swap<T>(arr: T[], i: number, j: number): T[] {
  if (i === j) return arr
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return arr
  const next = [...arr]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}
```

- [ ] **Step 4: Verify test passes**

Run: `npx vitest run src/__tests__/layout/swap.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/layout/swap.ts src/__tests__/layout/swap.test.ts
git commit -m "$(cat <<'EOF'
feat(layout): swap helper for pane reordering via drag-and-drop

Pure immutable swap. Guards i===j and out-of-bounds (returns the input
unchanged). Used by App.tsx's DndContext onDragEnd to swap panes[i]
↔ panes[j] without disturbing other slots — PTYs stay alive.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: PaneLayoutEngine component

**Files:**
- Create: `src/components/PaneLayoutEngine.tsx`

No unit test for this component (Electron + xterm-heavy children make RTL setup not worth it for v1.1.0). Manual smoke tests at Task 12.

- [ ] **Step 1: Implement the engine**

Create `src/components/PaneLayoutEngine.tsx`:

```tsx
import { Fragment, type ReactNode } from 'react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import type { PaneNode, LayoutId } from '../types'
import { getPreset, type Split } from '../layout/presets'

function equalSizes(count: number): number[] {
  if (count <= 0) return []
  const base = Math.floor(100 / count)
  const sizes = Array(count).fill(base)
  sizes[sizes.length - 1] += 100 - base * count
  return sizes
}

export interface PaneLayoutEngineProps {
  layoutId: LayoutId
  panes: PaneNode[]
  splitRatios?: Record<string, number[]>
  onResize: (path: string, sizes: number[]) => void
  renderPane: (pane: PaneNode) => ReactNode
  renderEmpty: (slot: number) => ReactNode
}

export function PaneLayoutEngine({
  layoutId, panes, splitRatios = {}, onResize, renderPane, renderEmpty,
}: PaneLayoutEngineProps) {
  const preset = getPreset(layoutId)
  return (
    <div className="grid-workspace">
      {renderSplit(preset.root, 'r', panes, splitRatios, onResize, renderPane, renderEmpty)}
    </div>
  )
}

function renderSplit(
  split: Split,
  path: string,
  panes: PaneNode[],
  splitRatios: Record<string, number[]>,
  onResize: (path: string, sizes: number[]) => void,
  renderPane: (pane: PaneNode) => ReactNode,
  renderEmpty: (slot: number) => ReactNode,
): ReactNode {
  if (split.kind === 'pane') {
    const pane = panes[split.slot]
    return pane ? renderPane(pane) : renderEmpty(split.slot)
  }

  const ratios = splitRatios[path] ?? equalSizes(split.children.length)
  const direction = split.kind === 'h' ? 'horizontal' : 'vertical'
  const handleClass = split.kind === 'h' ? 'resize-handle resize-handle--col' : 'resize-handle resize-handle--row'

  return (
    <PanelGroup
      key={path}
      direction={direction}
      onLayout={(sizes) => onResize(path, sizes)}
    >
      {split.children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <PanelResizeHandle className={handleClass} />}
          <Panel defaultSize={ratios[i]} minSize={8}>
            {renderSplit(child, `${path}/${i}`, panes, splitRatios, onResize, renderPane, renderEmpty)}
          </Panel>
        </Fragment>
      ))}
    </PanelGroup>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json 2>&1 | grep "PaneLayoutEngine"`
Expected: no output (the component itself is clean; existing baseline errors elsewhere are unaffected).

- [ ] **Step 3: Commit**

```bash
git add src/components/PaneLayoutEngine.tsx
git commit -m "$(cat <<'EOF'
feat(layout): PaneLayoutEngine component

Pure React renderer for the preset table. Walks the Split tree
recursively, emitting nested PanelGroup / Panel / PanelResizeHandle
from react-resizable-panels. Each pane leaf is rendered via the
parent-supplied renderPane callback so the engine itself stays
agnostic of TerminalPane / BrowserCell. splitRatios indexed by node
path drives Panel defaultSize; onResize feeds them back up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: LayoutSelector component

**Files:**
- Create: `src/components/LayoutSelector.tsx`
- Modify: `src/styles/global.css` (append rules)

- [ ] **Step 1: Implement the selector**

Create `src/components/LayoutSelector.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { LayoutId } from '../types'
import { PRESETS } from '../layout/presets'
import { alternativesFor } from '../layout/select'

interface Props {
  current: LayoutId
  paneCount: number
  onChange: (id: LayoutId) => void
}

export function LayoutSelector({ current, paneCount, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const options = alternativesFor(paneCount)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Cmd/Ctrl + L toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const currentPreset = PRESETS[current]

  return (
    <div className="layout-selector" ref={ref}>
      <button
        className="layout-selector-btn"
        onClick={() => setOpen(v => !v)}
        title={`Layout: ${currentPreset.label} (Ctrl+L)`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d={currentPreset.icon} />
        </svg>
      </button>
      {open && options.length > 0 && (
        <div className="layout-selector-popover">
          <div className="layout-selector-title">Layout — {paneCount} pane{paneCount === 1 ? '' : 's'}</div>
          <div className="layout-selector-grid">
            {options.map(id => {
              const preset = PRESETS[id]
              const active = id === current
              return (
                <button
                  key={id}
                  className={`layout-selector-option${active ? ' active' : ''}`}
                  onClick={() => { onChange(id); setOpen(false) }}
                  title={preset.label}
                >
                  <svg width="36" height="36" viewBox="0 0 16 16" fill="currentColor">
                    <path d={preset.icon} />
                  </svg>
                  <span>{preset.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add CSS rules**

Append to `src/styles/global.css`:

```css
/* ── Layout Selector ─────────────────────────────────────── */

.layout-selector {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 30;
}

.layout-selector-btn {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-muted);
  transition: color 0.15s, border-color 0.15s;
}

.layout-selector-btn:hover {
  color: var(--text-primary);
  border-color: var(--raven-blue);
}

.layout-selector-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  padding: 12px;
  min-width: 200px;
}

.layout-selector-title {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.layout-selector-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.layout-selector-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 10px;
  transition: border-color 0.15s, color 0.15s;
}

.layout-selector-option:hover {
  color: var(--text-primary);
  border-color: var(--raven-blue);
}

.layout-selector-option.active {
  color: var(--raven-blue);
  border-color: var(--raven-blue);
  background: #0066FF15;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json 2>&1 | grep "LayoutSelector"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/LayoutSelector.tsx src/styles/global.css
git commit -m "$(cat <<'EOF'
feat(layout): LayoutSelector with mini-mockup grid and Cmd+L shortcut

Top-right button on the workspace opens a popover with all alternative
presets for the current pane count. Each option shows an SVG mosaic
icon and the preset label; current selection is highlighted. Closes on
outside click, Escape, or selection. Cmd/Ctrl+L toggles globally.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Restore drag handle in TerminalPane / BrowserCell / PaneHeader

**Files:**
- Modify: `src/components/PaneHeader.tsx`
- Modify: `src/components/TerminalPane.tsx`
- Modify: `src/components/BrowserCell.tsx`

After Task 0 these files are back to v1.0.1 state. `PaneHeader` already supports `dragHandleProps` in v1.0.1. `TerminalPane` already calls `useSortable({ id: cellId })`. We need to change `cellId` → `pane.id` everywhere so the swap operates on stable pane identity.

- [ ] **Step 1: Read the relevant sections to align with current shape**

Run: `grep -n "useSortable\|cellId\|dragHandleProps" src/components/TerminalPane.tsx src/components/BrowserCell.tsx src/components/PaneHeader.tsx`
Expected: shows v1.0.1's `cellId: string` prop and `useSortable({ id: cellId })`.

- [ ] **Step 2: Update `TerminalPane.tsx` — change sortable id to pane.id**

In `src/components/TerminalPane.tsx`, find:
```ts
const { setNodeRef, attributes, listeners, transform, transition, isOver } = useSortable({ id: cellId })
```
Replace with:
```ts
const { setNodeRef, attributes, listeners, transform, transition, isOver } = useSortable({ id: pane.id })
```

Find the prop interface and remove `cellId`:
```ts
interface Props {
  pane: PaneNode
  cellId: string    // ← remove this line
  ...
}
```

Find the destructuring `export default function TerminalPane({ pane, cellId, …`, remove `cellId`.

Find every usage of `cellId` in the file (e.g. `data-cell-id={cellId}`, CustomEvent `detail.cellId`) and replace with `pane.id` / drop the field. There should be 2-4 occurrences.

- [ ] **Step 3: Update `BrowserCell.tsx` to be a drag source too**

In `src/components/BrowserCell.tsx`:

Add imports near the top:
```ts
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
```

Remove the `cellId: string` prop from the interface. Remove `cellId` from the destructured props.

Inside the component body, add (near the other state):
```ts
const { setNodeRef, attributes, listeners, transform, transition } = useSortable({ id: pane.id })
const sortableStyle: React.CSSProperties = {
  transform: CSS.Transform.toString(transform),
  transition,
}
```

Change the root element's ref and style:
```tsx
<div
  ref={setNodeRef}
  className="browser-cell"
  data-pane-id={pane.id}
  data-browser-untouched={isUntouched ? 'true' : undefined}
  style={{ ...sortableStyle, borderColor: accent }}
>
```

In the `.browser-header` button row, add a drag handle span at the start:
```tsx
<div className="browser-header" style={{ height: HEADER_HEIGHT }}>
  <span className="browser-drag-handle" {...listeners} {...attributes} />
  {/* …rest unchanged… */}
```

Anywhere `data-cell-id` appears, rename to `data-pane-id`. The querySelector inside the `nest:pty-url` listener: find `document.querySelector('[data-cell-id="${ce.detail.cellId}"]')` and change to `document.querySelector('[data-pane-id="${ce.detail.paneId}"]')`. The CustomEvent dispatched in `TerminalPane` (Task 2 above) carries `paneId`, not `cellId`.

- [ ] **Step 4: Update `PaneHeader.tsx`**

`PaneHeader.tsx` already has `dragHandleProps?: DragHandleProps` from v1.0.1 — no shape change needed. Just verify by:

Run: `grep -n "dragHandleProps" src/components/PaneHeader.tsx`
Expected: 3 lines — interface, function signature, and one usage that spreads it onto a `.pane-drag-handle` span.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json 2>&1 | wc -l`
Expected: still ≤ 18 (no new errors). Errors in `App.tsx` and `CommandPalette.tsx` consumers are expected; they'll be cleared in Task 8.

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalPane.tsx src/components/BrowserCell.tsx src/components/PaneHeader.tsx
git commit -m "$(cat <<'EOF'
feat(layout): drag panes by stable pane.id, browser panes draggable too

TerminalPane.useSortable now keys on pane.id instead of the
positional cellId — drag survives pane reordering and slot index
changes. BrowserCell becomes a sortable source as well so drag-to-swap
works for browser panes (with a tiny drag handle in the header).
data-cell-id renamed to data-pane-id everywhere.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire the engine in App.tsx

This is the largest task. Broken into substeps.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace imports**

In `src/App.tsx`, at the top of the imports block, ensure these:

```ts
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import {
  PaneNode, AIType, AI_CONFIG, SessionData, SessionPane, Workspace,
  WorkspaceTab, LayoutId,
} from './types'
import { PaneLayoutEngine } from './components/PaneLayoutEngine'
import { LayoutSelector } from './components/LayoutSelector'
import { defaultLayoutFor, alternativesFor, mapLegacyToPreset } from './layout/select'
import { swap } from './layout/swap'
import { getPreset } from './layout/presets'
```

Remove (if any leftover): `react-grid-layout` imports, `useFreeGrid`, `equalSizes`, `GridLayout`, `findFreeSlot`, `migrateLegacyGrid`, `WorkspaceCell`, `SessionCell`.

- [ ] **Step 2: Update initial tab state**

Find the `useState<WorkspaceTab[]>(...)` initialization:
```ts
const [tabs, setTabs] = useState<WorkspaceTab[]>([{
  id: initialTabId,
  name: 'Workspace',
  layout: { rows: 1, cols: 1 },
  colSizes: [equalSizes(1)],
  rowSizes: equalSizes(1),
  cells: [null],
}])
```
Replace with:
```ts
const [tabs, setTabs] = useState<WorkspaceTab[]>([{
  id: initialTabId,
  name: 'Workspace',
  layoutId: '1',
  panes: [],
}])
```

- [ ] **Step 3: Replace derived state and refs**

Find the block under `// Derive active tab data`:
```ts
const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0]
const layout = activeTab.layout
const cells = activeTab.cells
const colSizes: number[][] = activeTab.colSizes ?? Array.from({ length: layout.rows }, () => equalSizes(layout.cols))
const rowSizes = activeTab.rowSizes ?? equalSizes(layout.rows)
const cellsRef = useRef(cells)
cellsRef.current = cells
```
Replace with:
```ts
const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0]
const panes = activeTab.panes
const panesRef = useRef(panes)
panesRef.current = panes
```

- [ ] **Step 4: Replace `applyLayout` / `addPane` / `removePane` / `updatePaneColor` / `updatePaneNote`**

Remove `applyLayout` entirely (no LayoutPicker any more).

Replace `addPane`:
```ts
const addPane = useCallback((
  aiType: AIType, accountName: string, accountDir: string, borderColor: string,
  cmd: string, customLabel?: string, customColor?: string, shellId?: string
) => {
  const worktreePath = addingPane?.worktreePath
  updateActiveTab(t => {
    const pane: PaneNode = {
      id: generateId(), aiType, accountName, accountDir, borderColor, cmd,
      customLabel, customColor, shellId,
      repoPath: worktreePath ?? t.repoPath,
    }
    const nextPanes = [...t.panes, pane]
    // Promote layoutId if current preset is full and there's a default for the new size.
    const currentSlots = getPreset(t.layoutId).slotCount
    const layoutId: LayoutId = nextPanes.length > currentSlots
      ? defaultLayoutFor(nextPanes.length)
      : t.layoutId
    return { ...t, panes: nextPanes, layoutId }
  })
  setAddingPane(null)
}, [addingPane, updateActiveTab])
```

(Note: `addingPane` state type is `null | { worktreePath?: string }`. Declare it next to other useState: `const [addingPane, setAddingPane] = useState<null | { worktreePath?: string }>(null)`. If it already exists from earlier session work, keep that line.)

Replace `removePane`:
```ts
const removePane = useCallback((paneId: string) => {
  window.pty.kill(paneId)
  updateActiveTab(t => {
    const nextPanes = t.panes.filter(p => p.id !== paneId)
    // Demote layoutId if a smaller default fits the remaining panes.
    const naturalDefault = defaultLayoutFor(nextPanes.length)
    const naturalSlots = getPreset(naturalDefault).slotCount
    const layoutId: LayoutId = naturalSlots < getPreset(t.layoutId).slotCount
      ? naturalDefault
      : t.layoutId
    return { ...t, panes: nextPanes, layoutId }
  })
  if (zoomedPaneId === paneId) { setZoomedPaneId(null); setZoomingOut(false) }
  if (focusedPaneIdRef.current === paneId) {
    focusedPaneIdRef.current = null
    setFocusedPaneId(null)
  }
}, [updateActiveTab, zoomedPaneId])
```

Replace `updatePaneColor` / `updatePaneNote`:
```ts
const updatePaneColor = useCallback((paneId: string, borderColor: string) => {
  updateActiveTab(t => ({
    ...t,
    panes: t.panes.map(p => p.id === paneId ? { ...p, borderColor } : p),
  }))
}, [updateActiveTab])

const updatePaneNote = useCallback((paneId: string, note: string) => {
  updateActiveTab(t => ({
    ...t,
    panes: t.panes.map(p => p.id === paneId ? { ...p, note } : p),
  }))
}, [updateActiveTab])
```

- [ ] **Step 5: Replace `openBrowserCell`**

```ts
const openBrowserCell = useCallback((url: string) => {
  const pane: PaneNode = {
    id: generateId(),
    aiType: 'browser',
    accountName: 'browser',
    accountDir: '',
    borderColor: '#0066FF',
    cmd: '',
    url,
    sessionPartition: `persist:browser-${activeTabId}`,
  }
  updateActiveTab(t => {
    const nextPanes = [...t.panes, pane]
    const currentSlots = getPreset(t.layoutId).slotCount
    const layoutId: LayoutId = nextPanes.length > currentSlots
      ? defaultLayoutFor(nextPanes.length)
      : t.layoutId
    return { ...t, panes: nextPanes, layoutId }
  })
}, [activeTabId, updateActiveTab])
```

- [ ] **Step 6: Replace `handleRepoLink` and `handleRepoUnlink`**

```ts
const handleRepoLink = useCallback(async () => {
  try {
    const path = await window.dialog.openFolder()
    if (!path) return
    const isWin = window.platform.isWin
    const quoted = isWin ? `'${path.replace(/'/g, "''")}'` : `'${path.replace(/'/g, "'\\''")}'`
    const cdCmd = `${isWin ? 'Set-Location' : 'cd'} ${quoted}\r`
    for (const p of panesRef.current) {
      if (p.cmd === '' && await window.pty.exists(p.id)) {
        window.pty.write(p.id, cdCmd)
      }
    }
    updateActiveTab(t => ({
      ...t,
      repoPath: path,
      panes: t.panes.map(p => ({ ...p, repoPath: path })),
    }))
  } catch (err) { console.error('handleRepoLink error:', err) }
}, [updateActiveTab])

const handleRepoUnlink = useCallback(() => {
  updateActiveTab(t => ({
    ...t,
    repoPath: undefined,
    panes: t.panes.map(p => ({ ...p, repoPath: undefined })),
  }))
}, [updateActiveTab])
```

- [ ] **Step 7: Replace `handleWorktreeSelect`**

```ts
const handleWorktreeSelect = useCallback(async (worktreePath: string) => {
  const focusedId = focusedPaneIdRef.current
  const isWin = window.platform.isWin
  const quoted = isWin ? `'${worktreePath.replace(/'/g, "''")}'` : `'${worktreePath.replace(/'/g, "'\\''")}'`
  const cdCmd = `${isWin ? 'Set-Location' : 'cd'} ${quoted}\r`
  for (const p of panesRef.current) {
    if (p.cmd !== '') continue
    if (focusedId && p.id !== focusedId) continue
    if (await window.pty.exists(p.id)) window.pty.write(p.id, cdCmd)
  }
  updateActiveTab(t => {
    if (focusedId) {
      return { ...t, panes: t.panes.map(p => p.id === focusedId ? { ...p, repoPath: worktreePath } : p) }
    }
    return {
      ...t,
      repoPath: worktreePath,
      panes: t.panes.map(p => ({ ...p, repoPath: worktreePath })),
    }
  })
}, [updateActiveTab])
```

- [ ] **Step 8: Replace `saveWorkspace` and `loadWorkspace`**

```ts
const saveWorkspace = useCallback(async (name: string) => {
  const ws: Workspace = {
    id: `ws-${Date.now()}`,
    name,
    // Legacy snapshot fields kept for forward-compat. Workspace files older
    // than v1.1 expect layout/rows/cols — fill with a 1×N row.
    layout: { rows: 1, cols: Math.max(1, panesRef.current.length) },
    colSizes: [Array(Math.max(1, panesRef.current.length)).fill(0)],
    rowSizes: [100],
    cells: panesRef.current.map(p => ({
      aiType: p.aiType, accountName: p.accountName, accountDir: p.accountDir,
      borderColor: p.borderColor, cmd: p.cmd,
      customLabel: p.customLabel, customColor: p.customColor, note: p.note,
      shellId: p.shellId,
    })),
    resumeLastSession: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    repoPath: activeTab.repoPath,
  }
  await window.workspaces.save(ws)
}, [activeTab.repoPath])

const loadWorkspace = useCallback((ws: Workspace) => {
  const id = generateTabId()
  const restored = (ws.cells ?? []).filter((c): c is SessionPane => c != null)
    .map(sp => ({ ...sp, id: generateId() } as PaneNode))
  setTabs(prev => [...prev, {
    id,
    name: ws.name,
    layoutId: defaultLayoutFor(restored.length),
    panes: restored,
    repoPath: ws.repoPath,
  }])
  setActiveTabId(id)
}, [])
```

- [ ] **Step 9: Replace `handleTabNew` and `openRepoInNewTab`**

```ts
const handleTabNew = useCallback(() => {
  const id = generateTabId()
  setTabs(prev => [...prev, { id, name: 'Workspace', layoutId: '1', panes: [] }])
  setActiveTabId(id)
}, [])

const openRepoInNewTab = useCallback((repoFullName: string, localPath: string) => {
  const id = generateTabId()
  const folderName = repoFullName.includes('/') ? repoFullName.split('/')[1] : repoFullName
  setTabs(prev => [...prev, { id, name: folderName, layoutId: '1', panes: [], repoPath: localPath }])
  setActiveTabId(id)
  setMyReposOpen(false)
  setTeamsOpen(false)
}, [])
```

- [ ] **Step 10: Replace `closeTab` (kills PTYs)**

```ts
const closeTab = useCallback((id: string) => {
  const currentTabs = tabsRef.current
  const tab = currentTabs.find(t => t.id === id)
  if (tab) tab.panes.forEach(p => window.pty.kill(p.id))
  setTabActivity(prev => { const next = new Map(prev); next.delete(id); return next })
  setTabs(prev => {
    const next = prev.filter(t => t.id !== id)
    if (next.length === 0) {
      const fallbackId = generateTabId()
      setActiveTabId(fallbackId)
      return [{ id: fallbackId, name: 'Workspace', layoutId: '1', panes: [] }]
    }
    setActiveTabId(prevActive => {
      if (prevActive !== id) return prevActive
      const idx = currentTabs.findIndex(t => t.id === id)
      const remaining = currentTabs.filter(t => t.id !== id)
      return remaining[Math.max(0, idx - 1)]?.id ?? remaining[0]?.id ?? next[0].id
    })
    return next
  })
}, [])
```

`handleTabClose`: change `tab.cells.some(c => c !== null)` to `tab.panes.length > 0`.

- [ ] **Step 11: Replace `handlePaneActivity` and tab activity tracking**

```ts
const handlePaneActivity = useCallback((paneId: string, active: boolean) => {
  setTabActivity(prev => {
    const next = new Map(prev)
    const tabSet = new Set(next.get(activeTabId) ?? new Set<string>())
    if (active) tabSet.add(paneId)
    else tabSet.delete(paneId)
    next.set(activeTabId, tabSet)
    return next
  })
}, [activeTabId])

// And the state typing:
const [tabActivity, setTabActivity] = useState<Map<string, Set<string>>>(new Map())
```

Update `TabBar.tsx` prop type to match (`Map<string, Set<string>>`); the existing render of `activity.size > 0` does not care about element type.

- [ ] **Step 12: Replace keyboard shortcut handler — `Cmd+1..9` and `nextPane/prevPane`**

The block that loops `cellsRef.current.filter(Boolean)` becomes:

```ts
const all = panesRef.current
if (all.length === 0) return
const currentIdx = all.findIndex(p => p.id === focusedPaneIdRef.current)
const isNext = matchesBinding(e, kb.nextPane)
const next = isNext
  ? (currentIdx + 1) % all.length
  : (currentIdx - 1 + all.length) % all.length
const target = all[next]
setFocusedPaneId(target.id)
focusedPaneIdRef.current = target.id
focusTerminal(target.id)
```

`Cmd+1..9` block:
```ts
const n = parseInt(e.key, 10)
if (!isNaN(n) && n >= 1 && n <= 9) {
  e.preventDefault()
  const target = panesRef.current[n - 1]
  if (target) {
    setFocusedPaneId(target.id)
    focusedPaneIdRef.current = target.id
    focusTerminal(target.id)
  }
  return
}
```

`toggleZoom` block:
```ts
if (zoomedPaneIdRef.current !== null) { handleUnzoom(); return }
const focusedId = focusedPaneIdRef.current
if (focusedId) handleZoom(focusedId)
return
```

(Replace the existing `zoomedCell` numeric state with `zoomedPaneId: string | null`: declare next to other useState; update refs; `handleZoom(paneId: string)`.)

- [ ] **Step 13: Replace session load/save**

Replace the `useEffect` block that calls `window.session.load`:

```ts
useEffect(() => {
  window.session.load().then((data) => {
    if (!data) return

    const COLOR_MIGRATION: Record<string, string> = {
      '#3B82F6': '#0055FF', '#EF4444': '#FF1A1A', '#10B981': '#00CC44',
      '#F59E0B': '#FFB800', '#8B5CF6': '#CC44FF', '#EC4899': '#FF2D78',
      '#06B6D4': '#00CCCC', '#F97316': '#FF6600', '#6366F1': '#4455FF',
      '#84CC16': '#88FF00', '#6B7280': '#666666',
    }

    const sessionToPane = (sp: SessionPane): PaneNode => {
      const borderColor = COLOR_MIGRATION[sp.borderColor] ?? sp.borderColor
      return {
        ...sp,
        id: generateId(),
        cmd: sp.cmd ?? AI_CONFIG[sp.aiType]?.cmd ?? '',
        borderColor,
      } as PaneNode
    }

    const migrate = (raw: NonNullable<SessionData['tabs']>[number]): WorkspaceTab => {
      if (raw.layoutId && Array.isArray(raw.panes)) {
        return {
          id: raw.id, name: raw.name, accentColor: raw.accentColor, repoPath: raw.repoPath,
          layoutId: raw.layoutId,
          panes: raw.panes.map(sessionToPane),
          splitRatios: raw.splitRatios ?? {},
        }
      }
      // v2: layout + cells
      const live = (raw.cells ?? []).filter((c): c is SessionPane => c != null).map(sessionToPane)
      const layoutId = raw.layout
        ? mapLegacyToPreset(raw.layout.rows, raw.layout.cols, live.length)
        : defaultLayoutFor(live.length)
      return {
        id: raw.id, name: raw.name, accentColor: raw.accentColor, repoPath: raw.repoPath,
        layoutId,
        panes: live,
      }
    }

    // v1 legacy: flat layout + cells at root
    if (!data.tabs && data.layout && data.cells) {
      const live = data.cells.filter((c): c is SessionPane => c != null).map(sessionToPane)
      const id = `tab-${Date.now()}`
      setTabs([{
        id,
        name: 'Workspace',
        layoutId: mapLegacyToPreset(data.layout.rows, data.layout.cols, live.length),
        panes: live,
      }])
      setActiveTabId(id)
      return
    }

    if (data.tabs && data.tabs.length > 0) {
      const restored = data.tabs.map(migrate)
      Promise.all(restored.map(async (t) => {
        if (!t.repoPath) return t
        const exists = await window.pathUtils.exists(t.repoPath)
        if (exists) return t
        console.warn('[session] dropping stale repoPath for tab', t.name, t.repoPath)
        return { ...t, repoPath: undefined }
      })).then((cleaned) => {
        setTabs(cleaned)
        setActiveTabId(data.activeTabId ?? cleaned[0].id)
      })
    }
  })
}, [])
```

Replace the save effect:
```ts
useEffect(() => {
  const timer = setTimeout(() => {
    const sessionData: SessionData = {
      tabs: tabs.map(tab => ({
        id: tab.id,
        name: tab.name,
        accentColor: tab.accentColor,
        repoPath: tab.repoPath,
        layoutId: tab.layoutId,
        panes: tab.panes.map(p => ({
          aiType: p.aiType, accountName: p.accountName, accountDir: p.accountDir,
          borderColor: p.borderColor, cmd: p.cmd,
          customLabel: p.customLabel, customColor: p.customColor, note: p.note,
          repoPath: p.repoPath,
          shellId: p.shellId,
        })),
        splitRatios: tab.splitRatios,
      })),
      activeTabId,
    }
    window.session.save(sessionData)
  }, 800)
  return () => clearTimeout(timer)
}, [tabs, activeTabId])
```

- [ ] **Step 14: Add the swap drag handler and split-ratio handler**

Inside the component body:
```ts
const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
const [draggingId, setDraggingId] = useState<string | null>(null)

const handleDragStart = useCallback((e: DragStartEvent) => {
  setDraggingId(String(e.active.id))
}, [])

const handleDragEnd = useCallback((e: DragEndEvent) => {
  setDraggingId(null)
  const { active, over } = e
  if (!over || active.id === over.id) return
  updateActiveTab(t => {
    const from = t.panes.findIndex(p => p.id === active.id)
    const to = t.panes.findIndex(p => p.id === over.id)
    if (from < 0 || to < 0) return t
    return { ...t, panes: swap(t.panes, from, to) }
  })
}, [updateActiveTab])

const handleSplitResize = useCallback((path: string, sizes: number[]) => {
  updateActiveTab(t => ({
    ...t,
    splitRatios: { ...(t.splitRatios ?? {}), [path]: sizes },
  }))
}, [updateActiveTab])

const handleLayoutIdChange = useCallback((id: LayoutId) => {
  updateActiveTab(t => ({ ...t, layoutId: id, splitRatios: {} }))
}, [updateActiveTab])
```

- [ ] **Step 15: Replace the workspace render block**

Find the `<div className="workspace">` block and its `DndContext`/`PanelGroup` children. Replace with:

```tsx
<div
  ref={workspaceRef}
  className={`workspace${dropActive ? ' grid-workspace--drop-target' : ''}`}
  onDragOver={handleDragOver}
  onDragLeave={handleDragLeave}
  onDrop={handleDrop}
>
  {isInitialState ? (
    <EmptyState onNewPane={addNextPane} />
  ) : (
    <>
      {zoomedPaneId !== null && (
        <div
          className={`zoom-backdrop${zoomingOut ? ' zooming-out' : ''}`}
          onClick={handleUnzoom}
        />
      )}
      <LayoutSelector
        current={activeTab.layoutId}
        paneCount={panes.length}
        onChange={handleLayoutIdChange}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={panes.map(p => p.id)} strategy={rectSortingStrategy}>
          <PaneLayoutEngine
            layoutId={activeTab.layoutId}
            panes={panes}
            splitRatios={activeTab.splitRatios}
            onResize={handleSplitResize}
            renderPane={(pane) => pane.aiType === 'browser'
              ? (
                <BrowserCell
                  key={pane.id}
                  pane={pane}
                  borderColor={pane.borderColor}
                  siblingPaneIds={panes.filter(p => p.id !== pane.id).map(p => p.id)}
                  workspaceRepoPath={activeTab.repoPath ?? pane.repoPath}
                  onClose={() => removePane(pane.id)}
                />
              )
              : (
                <TerminalPane
                  key={pane.id}
                  pane={pane}
                  isDragging={draggingId === pane.id}
                  zoomed={zoomedPaneId === pane.id}
                  zoomingOut={zoomedPaneId === pane.id && zoomingOut}
                  onZoom={() => handleZoom(pane.id)}
                  onClose={() => removePane(pane.id)}
                  onColorChange={(c) => updatePaneColor(pane.id, c)}
                  onNoteChange={(note) => updatePaneNote(pane.id, note)}
                  fontSize={fontSize}
                  onInput={(data) => {
                    const targets = broadcastMode ? panes.map(p => p.id) : [pane.id]
                    targets.forEach((id) => window.pty.write(id, data))
                  }}
                  onFocus={() => {
                    setFocusedPaneId(pane.id)
                    focusedPaneIdRef.current = pane.id
                  }}
                  onBusyChange={handleBusyChange}
                  onActivity={handlePaneActivity}
                  onJoinRequest={() => setJoinRequest({ paneId: pane.id, paneTitle: pane.customLabel ?? pane.accountName ?? 'Terminal' })}
                />
              )
            }
            renderEmpty={(_slot) => (
              <EmptyCell onClick={() => setAddingPane({})} />
            )}
          />
        </SortableContext>
        <DragOverlay>
          {draggingId !== null && (() => {
            const pane = panes.find(p => p.id === draggingId)
            return pane ? (
              <div className="drag-overlay-pane" style={{ '--pane-color': pane.borderColor } as React.CSSProperties}>
                <div className="pane-header" style={{ borderBottom: `1px solid ${pane.borderColor}44` }}>
                  <span className="pane-ai-label" style={{ color: AI_CONFIG[pane.aiType].color, paddingLeft: 10 }}>
                    {AI_CONFIG[pane.aiType].label}
                  </span>
                  <span className="pane-account-name" style={{ paddingLeft: 6 }}>{pane.accountName}</span>
                </div>
              </div>
            ) : null
          })()}
        </DragOverlay>
      </DndContext>
    </>
  )}
</div>
```

`EmptyCell` keeps the v1.0.1 signature `{ cellId, onClick }` — change call sites to drop the unused `cellId`. Or simplify the component to just `{ onClick }`:
```tsx
function EmptyCell({ onClick }: { onClick: () => void }) {
  return (
    <div className="empty-cell" onClick={onClick}>
      <span className="empty-cell-icon">+</span>
      <span className="empty-cell-label">New Terminal</span>
    </div>
  )
}
```

- [ ] **Step 16: Update Sidebar props (remove layout/onLayoutChange)**

In the `<Sidebar ...>` JSX inside `App.tsx`, remove `layout={layout}` and `onLayoutChange={applyLayout}` props.

In `src/components/Sidebar.tsx`, remove `layout`, `onLayoutChange`, the `LayoutPicker` import, and the Layout section. (If Task 0's revert restored Sidebar to v1.0.1 with these props still present, edit now.)

- [ ] **Step 17: Update `CommandPalette.tsx`**

`tab.cells.filter(Boolean).length` → `tab.panes.length`.

- [ ] **Step 18: Update workspace drop handlers**

Add to `App.tsx`:
```ts
const WORKTREE_DRAG_MIME = 'application/x-raven-worktree-path'
const [dropActive, setDropActive] = useState(false)
const workspaceRef = useRef<HTMLDivElement>(null)

const handleDragOver = useCallback((e: React.DragEvent) => {
  if (!Array.from(e.dataTransfer.types).includes(WORKTREE_DRAG_MIME)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  if (!dropActive) setDropActive(true)
}, [dropActive])

const handleDragLeave = useCallback((e: React.DragEvent) => {
  if (e.currentTarget.contains(e.relatedTarget as Node)) return
  setDropActive(false)
}, [])

const handleDrop = useCallback((e: React.DragEvent) => {
  const path = e.dataTransfer.getData(WORKTREE_DRAG_MIME)
  setDropActive(false)
  if (!path) return
  e.preventDefault()
  setAddingPane({ worktreePath: path })
}, [])
```

In `WorktreesSection.tsx`, ensure each item has:
```tsx
<div
  draggable
  onDragStart={(e) => {
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('application/x-raven-worktree-path', wt.repoPath)
    e.dataTransfer.setData('text/plain', wt.repoPath)
  }}
  ...
>
```

- [ ] **Step 19: Run unit tests and typecheck**

```bash
npx vitest run src/__tests__/layout
npx tsc --noEmit -p tsconfig.web.json 2>&1 | wc -l
```
Expected: tests all pass; typecheck error count ≤ 18.

- [ ] **Step 20: Renderer build sanity**

```bash
npm run build 2>&1 | tail -5
```
Expected: `built in <Ns>` with no errors.

- [ ] **Step 21: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx src/components/CommandPalette.tsx src/components/WorktreesSection.tsx
git commit -m "$(cat <<'EOF'
feat(layout): tiling engine wired in App.tsx — swap drag, presets, drop

Replaces the v1.0.x rows×cols PanelGroup logic with PaneLayoutEngine,
LayoutSelector, and a DndContext that swaps panes by id. addPane /
removePane / openBrowserCell promote and demote layoutId via the
defaultLayoutFor table. Session save/load now produces v3 (layoutId +
panes + splitRatios) with v1/v2 migrations through mapLegacyToPreset.
Worktree drop on the workspace opens NewPaneDialog preloaded with cwd.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: CSS polish for the new engine

**Files:**
- Modify: `src/styles/global.css`

The `.grid-workspace` rules from v1.0.1 already cover `PanelGroup`. We need to:

- Make the workspace `position: relative` so `LayoutSelector` (absolute) anchors to it.
- Add `data-pane-id` and drag-overlay tweaks if missing.

- [ ] **Step 1: Ensure workspace is positioned**

In `src/styles/global.css`, find the `.workspace` rule (it should set `flex: 1; min-height: 0; display: flex; flex-direction: column;`). Add `position: relative;` if absent.

- [ ] **Step 2: Add drop indicator rule (if not present from earlier)**

Append:
```css
.workspace.grid-workspace--drop-target {
  outline: 2px dashed var(--raven-blue);
  outline-offset: -6px;
  background: #0066FF08;
}
```

- [ ] **Step 3: Add `browser-drag-handle` style (used by BrowserCell Task 7)**

```css
.browser-drag-handle {
  width: 16px;
  height: 100%;
  cursor: grab;
  margin-right: 4px;
  border-right: 1px dashed var(--border);
}
.browser-drag-handle:active { cursor: grabbing; }
```

- [ ] **Step 4: Commit**

```bash
git add src/styles/global.css
git commit -m "$(cat <<'EOF'
style(layout): workspace anchor, drop indicator, browser drag handle

position: relative on .workspace so the LayoutSelector popover anchors
correctly. Dashed blue outline when a worktree is being dragged over
the workspace. Small drag handle area on browser-header for the new
sortable behavior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Uninstall react-grid-layout

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Verify no source file imports it**

Run: `grep -rn "react-grid-layout" src/ electron/`
Expected: no matches.

- [ ] **Step 2: Uninstall**

```bash
npm uninstall react-grid-layout @types/react-grid-layout
```

- [ ] **Step 3: Verify build still passes**

```bash
npm run build 2>&1 | tail -5
```
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): drop react-grid-layout — superseded by tiling engine

The v1.1 layout engine uses react-resizable-panels (already a v1.0.x
dep) plus a custom preset table. react-grid-layout was tried earlier
on this branch as a free-grid solution; tiling fits the product
better and removes a 200+ KB dependency from the renderer bundle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Full test suite + final typecheck

- [ ] **Step 1: Run all tests**

```bash
npm test
```
Expected: vitest summary green; layout/* tests, electron/* tests all pass.

- [ ] **Step 2: Full typecheck**

```bash
npx tsc --noEmit -p tsconfig.web.json 2>&1 | wc -l
```
Expected: ≤ 18 (baseline preserved).

- [ ] **Step 3: Full electron build**

```bash
npm run build
```
Expected: main + preload + renderer all build successfully.

---

## Task 12: Manual smoke test

This is a checklist for the engineer to run in dev mode before declaring the work complete.

- [ ] **Step 1: Launch dev**

```bash
npm run dev
```

- [ ] **Step 2: Empty state → 1 pane → 2 → 3 → 4 → 5 → 6**

Click `+ New Pane` six times, picking any AI. Verify:
- 1 pane → full-screen
- 2 → side-by-side (`2V`)
- 3 → three equal columns (`3C`)
- 4 → quadrants (`4Q`)
- 5 → three over two (`5T`)
- 6 → 3×2 grid (`6G`)

- [ ] **Step 3: Switch alternatives at N=3**

Click the mosaics button (top-right). Pick `3M`. Verify master + stack appears. Pick `3T`. Verify top split + bottom. Back to `3C`.

- [ ] **Step 4: Swap drag**

Drag pane 1's header onto pane 3. Verify they swap and **neither PTY restarts** (their prompts and history persist).

- [ ] **Step 5: Resize**

Drag a split handle to change ratio. Close the app. Re-launch. Verify the ratio persists.

- [ ] **Step 6: Worktree drop**

Link a repo, expand worktrees in the sidebar. Drag a worktree onto the workspace. Verify `NewPaneDialog` opens with cwd preloaded. Confirm an AI; new pane appears at the worktree path.

- [ ] **Step 7: Close panes**

Close them one by one. Verify the engine snaps back to defaults: 6 → 5T → 4Q → 3C → 2V → 1.

- [ ] **Step 8: Out-of-viewport check**

At any state, verify no pane ever renders outside `.workspace` bounds — drag-and-drop only swaps, never repositions absolutely.

- [ ] **Step 9: Sign off**

If all 8 steps pass, push the branch and open the PR.

```bash
git push -u origin feat/free-grid
gh pr create --title "feat: pane layout engine for v1.1 — tiling with switchable presets" --body "$(cat <<'EOF'
## Summary

- Replaces the v1.0.x rows×cols `PanelGroup` grid with a tiling engine driven by a preset table (`src/layout/presets.ts`).
- 11 presets covering 1 / 2 / 3 / 4 / 5 / 6 / 9 panes with default-per-N selection.
- Drag-and-drop swap between panes (PTYs stay alive across moves and layout switches).
- Resizable splits via `react-resizable-panels`; ratios persist in `session.json`.
- Worktrees from the sidebar can be dragged onto the workspace to open `NewPaneDialog` preloaded with cwd.
- Session migration v1/v2 → v3 (`layoutId` + `panes` + `splitRatios`).
- Drops the failed `react-grid-layout` attempt.

Design spec: `docs/superpowers/specs/2026-05-13-pane-layout-design.md`.
Plan: `docs/superpowers/plans/2026-05-13-pane-layout-engine.md`.

## Test plan

- [x] Vitest unit tests (`src/__tests__/layout/*.test.ts`) green
- [x] `npx tsc --noEmit -p tsconfig.web.json` baseline preserved (18 preexisting)
- [x] `npm run build` clean
- [x] Manual smoke (steps 2-8 of the plan)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review (already applied)

- **Spec coverage:** Every section of `2026-05-13-pane-layout-design.md` maps to a task: preset table → Task 2; defaults/alternatives → Task 3; engine component → Task 5; selector → Task 6; drag swap → Tasks 7 + 8 step 14; persistence + migration → Task 8 step 13; cleanup → Task 0 + Task 10.
- **Placeholders:** No `TBD`, no "implement later". Every code step shows the actual code.
- **Type consistency:** `LayoutId` defined in Task 1, used uniformly. `Split`, `LayoutPreset` defined in Task 2, consumed in Task 5. `swap()` defined in Task 4, consumed in Task 8.
- **Scope:** One coherent feature; no decomposition needed.
- **One gap noticed during review:** Task 8 step 12 mentions `zoomedPaneId` but didn't declare its `useState` in earlier substeps. Fixed inline (declaration is in the same step alongside other state).
