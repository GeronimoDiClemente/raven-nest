# Hub Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Hub" overlay (`Ctrl/Cmd+Shift+O`) that shows, in a grid, all the live terminals from every workspace and lets you type in any of them; `Esc` returns to the previous pane.

**Architecture:** The grid (`HubGrid`) is a pure, reusable component; the container (`HubOverlay`) is a UI state in `App` (same pattern as CommandPalette/GlobalSearch). Each tile mounts its own xterm connected to the existing PTY by `paneId` via `subscribeToPtyData` + `getBuffer` — it never creates or kills PTYs. Spec: `docs/superpowers/specs/2026-07-14-hub-overlay-design.md`.

**Tech Stack:** Electron + Vite + React + TypeScript (strict), xterm.js (`@xterm/xterm` + `@xterm/addon-fit`), node-pty already present in main. **No new dependencies.**

## Global Constraints

- Branch: `feat/hub-overlay` (worktree `C:\Users\matia\raven-nest-wt\feat-hub-overlay`). **FORBIDDEN** to push to `main` or merge; the final deliverable is a draft PR for Gero's review.
- TypeScript strict: `npm run build` must pass clean after EVERY task (it's the repo's type-gate; there is no automated test suite — CONTRIBUTING asks to exercise the feature in the real app with `npm run dev` and document the manual test path).
- Styles: only existing tokens (`--raven-blue`, `--bg-*`, `--border`, `--text-*`, `--pane-color`). Zero new hardcoded colors (except those already present in the codebase, e.g. the activity dot's `#22C55E`, referenced as-is).
- Hard rules for coexisting with the existing code:
  - **NEVER** call `registerPane()` from the Hub (it's a `Map` of a single callback per pane: it would overwrite the active workspace's `TerminalPane` callback). Use `subscribeToPtyData()`.
  - **NEVER** call `registerTerminal()` from the Hub (it would overwrite the real pane's instance in the GlobalSearch registry).
  - **NEVER** kill PTYs when unmounting tiles (`term.dispose()` yes, `pty.kill` never).
  - PTY resize: only the focused tile and only if its pane does NOT belong to the active tab (those panes are mounted at real size behind the overlay).
- Panes with `aiType === 'browser'` are left out of the Hub (they have no PTY).
- Commits: repo style, short and imperative, with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

- Create: `src/hooks/useHubTerminal.ts` — lightweight xterm for tiles (replay + stream + input; no search/weblinks/registry).
- Create: `src/components/HubTile.tsx` — individual tile (header + xterm + pin + ended).
- Create: `src/components/HubGrid.tsx` — pure grid + `HubEntry`/`HubFilter` types + `filterEntries()`.
- Create: `src/components/HubOverlay.tsx` — overlay container (filters, pagination, keyboard, focus).
- Modify: `src/types.ts` — `pinned?: boolean` on `PaneNode` (line ~40) and `SessionPane` (line ~220).
- Modify: `src/lib/keybindings.ts` — `hubOverlay` binding.
- Modify: `src/components/CommandPalette.tsx` — `onHubOpen` prop + action item.
- Modify: `src/App.tsx` — `hubOpen` state, handlers, keybind, tab bar button, `pinned` persistence.
- Modify: `src/styles/global.css` — `/* ── Hub Overlay ── */` section at the end.

---

### Task 1: Types, keybinding and `pinned` persistence

**Files:**
- Modify: `src/types.ts` (`PaneNode` and `SessionPane` interfaces)
- Modify: `src/lib/keybindings.ts` (`Keybindings` interface + `DEFAULT_SETTINGS`)
- Modify: `src/App.tsx` (session save mapping, ~line 819)

**Interfaces:**
- Produces: `PaneNode.pinned?: boolean`, `SessionPane.pinned?: boolean`, `kb.hubOverlay` (binding `'Meta+Shift+O'` → Ctrl on Win/Linux, ⌘ on Mac). `sessionToPane` already spreads `...sp`, so `pinned` flows through on restore on its own.

- [ ] **Step 1: Add `pinned` to `PaneNode`**

In `src/types.ts`, inside `interface PaneNode` (after `shellId?: string`):

```ts
  shellId?: string      // terminal panes only: which shell to spawn (Windows shell picker)
  pinned?: boolean      // Hub: user-pinned pane, shows under the "Pinned" filter
```

- [ ] **Step 2: Add `pinned` to `SessionPane`**

In `src/types.ts`, inside `interface SessionPane` (after `url?: string`):

```ts
  url?: string  // browser only: last navigated URL, restored on session load
  pinned?: boolean  // Hub pin — survives session restore
```

- [ ] **Step 3: Persist `pinned` in the session save**

In `src/App.tsx`, in the save `useEffect` (~line 819), the `panes: tab.panes.map(p => ({ ... }))` mapping — add after `shellId: p.shellId,`:

```ts
            shellId: p.shellId,
            pinned: p.pinned,
```

(The restore needs no changes: `sessionToPane` does `...sp`.)

- [ ] **Step 4: Add `hubOverlay` keybinding**

In `src/lib/keybindings.ts`:

```ts
export interface Keybindings {
  voiceInput: string
  newPane: string
  globalSearch: string
  commandPalette: string
  hubOverlay: string
  nextPane: string
  // ... rest unchanged
```

and in `DEFAULT_SETTINGS.keybindings`, after `commandPalette: 'Meta+k',`:

```ts
    commandPalette: 'Meta+k',
    hubOverlay: 'Meta+Shift+O',
```

Note: `useSettings` merges `{ ...DEFAULT_SETTINGS.keybindings, ...s.keybindings }`, so old saved settings pick up the default automatically.

- [ ] **Step 5: Verify type-check**

Run: `npm run build`
Expected: build OK, no TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/lib/keybindings.ts src/App.tsx
git commit -m "feat(hub): pinned on PaneNode/SessionPane + hubOverlay keybinding

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Hook `useHubTerminal`

**Files:**
- Create: `src/hooks/useHubTerminal.ts`

**Interfaces:**
- Consumes: `subscribeToPtyData` (`src/pty-events.ts:35`), `window.pty.getBuffer/write/resize`.
- Produces: `useHubTerminal(paneId: string, canResizePty: boolean): { containerRef: React.RefObject<HTMLDivElement>, focusTile: () => void }`. `canResizePty` = the pane does NOT belong to the active tab.

- [ ] **Step 1: Create the full hook**

`src/hooks/useHubTerminal.ts`:

```ts
import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { subscribeToPtyData } from '../pty-events'

// Replay only the tail of the 10k-line main-process buffer — a compact tile
// doesn't need full scroll-back and writing 10k lines × 12 tiles at once
// would jank the overlay open animation.
const TAIL_LINES = 200

/**
 * Lightweight xterm for Hub tiles. Attaches to an EXISTING PTY by paneId:
 * replays the buffer tail, subscribes to the global data bus, forwards input.
 * Never creates or kills the PTY, never touches the pane registries
 * (registerPane/registerTerminal are single-slot per paneId and belong to
 * the real TerminalPane).
 *
 * PTY resize policy: only when `canResizePty` (pane is NOT in the active
 * tab — active-tab panes stay mounted at real size behind the overlay) and
 * only when this tile owns keyboard focus.
 */
export function useHubTerminal(paneId: string, canResizePty: boolean) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const canResizeRef = useRef(canResizePty)
  canResizeRef.current = canResizePty

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const fontFamily = window.platform?.isMac
      ? '"SF Mono", "Menlo", "Monaco", monospace'
      : '"Cascadia Mono", "Cascadia Code", "Consolas", monospace'

    const term = new Terminal({
      fontFamily,
      fontSize: 11,
      lineHeight: 1.3,
      cursorBlink: false,
      cursorStyle: 'bar',
      scrollback: 1000,
      theme: {
        background: '#000000',
        foreground: '#e8e8e8',
        cursor: '#0066FF',
        selectionBackground: '#0066FF33',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    termRef.current = term
    fitRef.current = fit

    // Fit the xterm view to the tile WITHOUT resizing the PTY — view-only.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try { fit.fit() } catch { /* ignore */ }
      })
    })

    let alive = true
    window.pty.getBuffer(paneId).then((buf) => {
      if (!alive || !buf) return
      const tail = buf.split('\n').slice(-TAIL_LINES).join('\n')
      term.write(tail)
    })

    const unsubscribe = subscribeToPtyData((id, data) => {
      if (id === paneId) term.write(data)
    })

    // Input flows only when this xterm has DOM focus — xterm only emits
    // onData for the focused instance, so no extra gating is needed.
    term.onData((data) => window.pty.write(paneId, data))

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          if (!container.clientWidth || !container.clientHeight) return
          fit.fit()
          if (canResizeRef.current && container.contains(document.activeElement)) {
            window.pty.resize(paneId, term.cols, term.rows)
          }
        } catch { /* ignore */ }
      })
    })
    resizeObserver.observe(container)

    return () => {
      alive = false
      unsubscribe()
      resizeObserver.disconnect()
      // Do NOT kill the PTY — same contract as TerminalPane.
      term.dispose()
    }
  }, [paneId])

  const focusTile = useCallback(() => {
    const term = termRef.current
    if (!term) return
    term.focus()
    if (canResizeRef.current && fitRef.current) {
      try {
        fitRef.current.fit()
        window.pty.resize(paneId, term.cols, term.rows)
      } catch { /* ignore */ }
    }
  }, [paneId])

  return { containerRef, focusTile }
}
```

- [ ] **Step 2: Verify type-check**

Run: `npm run build`
Expected: OK (the hook isn't used yet; it must not break anything).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useHubTerminal.ts
git commit -m "feat(hub): useHubTerminal — lightweight xterm attached to an existing PTY

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `HubGrid` (types + pure filter + grid) and `HubTile`

**Files:**
- Create: `src/components/HubGrid.tsx`
- Create: `src/components/HubTile.tsx`

**Interfaces:**
- Consumes: `useHubTerminal(paneId, canResizePty)` (Task 2), `PaneNode`/`AI_CONFIG` from `../types`.
- Produces (used by Task 4):
  - `interface HubEntry { pane: PaneNode; tabId: string; tabName: string; isActiveTab: boolean; busy: boolean }`
  - `type HubFilter = 'all' | 'active' | 'pinned' | { tabId: string }`
  - `function filterEntries(entries: HubEntry[], filter: HubFilter): HubEntry[]`
  - `<HubGrid entries focusedPaneId onFocus onJump onTogglePin />`

- [ ] **Step 1: Create `src/components/HubGrid.tsx`**

```tsx
import { PaneNode } from '../types'
import HubTile from './HubTile'

export interface HubEntry {
  pane: PaneNode
  tabId: string
  tabName: string
  isActiveTab: boolean
  busy: boolean
}

export type HubFilter = 'all' | 'active' | 'pinned' | { tabId: string }

export function filterEntries(entries: HubEntry[], filter: HubFilter): HubEntry[] {
  if (filter === 'all') return entries
  if (filter === 'active') return entries.filter(e => e.busy)
  if (filter === 'pinned') return entries.filter(e => e.pane.pinned)
  return entries.filter(e => e.tabId === filter.tabId)
}

interface Props {
  entries: HubEntry[]
  focusedPaneId: string | null
  onFocus: (paneId: string) => void
  onJump: (tabId: string, paneId: string) => void
  onTogglePin: (tabId: string, paneId: string) => void
}

export default function HubGrid({ entries, focusedPaneId, onFocus, onJump, onTogglePin }: Props) {
  if (entries.length === 0) {
    return <div className="hub-empty">No terminals for this filter</div>
  }
  return (
    <div className="hub-grid">
      {entries.map(e => (
        <HubTile
          key={e.pane.id}
          entry={e}
          focused={focusedPaneId === e.pane.id}
          onFocus={onFocus}
          onJump={onJump}
          onTogglePin={onTogglePin}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create `src/components/HubTile.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { AI_CONFIG } from '../types'
import { useHubTerminal } from '../hooks/useHubTerminal'
import type { HubEntry } from './HubGrid'

interface Props {
  entry: HubEntry
  focused: boolean
  onFocus: (paneId: string) => void
  onJump: (tabId: string, paneId: string) => void
  onTogglePin: (tabId: string, paneId: string) => void
}

export default function HubTile({ entry, focused, onFocus, onJump, onTogglePin }: Props) {
  const { pane, tabId, tabName, isActiveTab, busy } = entry
  // Active-tab panes stay mounted at real size behind the overlay — never
  // resize their PTY from a tile (see spec: "PTY size").
  const { containerRef, focusTile } = useHubTerminal(pane.id, !isActiveTab)
  const [ended, setEnded] = useState(false)

  useEffect(() => {
    let alive = true
    window.pty.exists(pane.id).then(exists => { if (alive) setEnded(!exists) })
    return () => { alive = false }
  }, [pane.id])

  // External focus (Tab cycling from HubOverlay) → focus the xterm too
  useEffect(() => {
    if (focused) focusTile()
  }, [focused, focusTile])

  const aiColor = pane.borderColor ?? pane.customColor ?? AI_CONFIG[pane.aiType]?.color ?? '#888888'
  const aiLabel = pane.customLabel ?? AI_CONFIG[pane.aiType].label

  return (
    <div
      className={`hub-tile${focused ? ' focused' : ''}`}
      style={{ '--pane-color': aiColor } as React.CSSProperties}
      onMouseDown={() => { onFocus(pane.id); focusTile() }}
      onDoubleClick={() => onJump(tabId, pane.id)}
    >
      <div className="hub-tile-header">
        <span className="pane-color-btn" style={{ background: aiColor, cursor: 'default' }} />
        <span className="pane-ai-label" style={{ color: aiColor }}>{aiLabel}</span>
        {pane.accountName && !AI_CONFIG[pane.aiType]?.noAccount && (
          <span className="pane-account-name">{pane.accountName}</span>
        )}
        <span className="hub-tile-ws" title={`Workspace: ${tabName}`}>{tabName}</span>
        {busy && !ended && <span className="hub-tile-busy" />}
        {ended && <span className="pane-ended-badge">ended</span>}
        <span className="hub-tile-spacer" />
        <button
          className={`hub-tile-pin${pane.pinned ? ' pinned' : ''}`}
          title={pane.pinned ? 'Unpin' : 'Pin to Hub'}
          onClick={(e) => { e.stopPropagation(); onTogglePin(tabId, pane.id) }}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          pin
        </button>
      </div>
      <div ref={containerRef} className="hub-tile-terminal" />
    </div>
  )
}
```

- [ ] **Step 3: Verify type-check**

Run: `npm run build`
Expected: OK. (The CSS classes don't exist yet — they're added in Task 4; it doesn't affect the build.)

- [ ] **Step 4: Commit**

```bash
git add src/components/HubGrid.tsx src/components/HubTile.tsx
git commit -m "feat(hub): HubGrid + HubTile — reusable terminal grid

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `HubOverlay` (filters, pagination, keyboard) + CSS

**Files:**
- Create: `src/components/HubOverlay.tsx`
- Modify: `src/styles/global.css` (new section at the end of the file)

**Interfaces:**
- Consumes: `HubEntry`, `HubFilter`, `filterEntries`, `HubGrid` (Task 3); `WorkspaceTab` from `../types`.
- Produces (consumed by Task 5): `<HubOverlay tabs activeTabId busyPanes onClose onJump onTogglePin />` with `onJump: (tabId: string, paneId: string) => void`, `onTogglePin: (tabId: string, paneId: string) => void`.

- [ ] **Step 1: Create `src/components/HubOverlay.tsx`**

```tsx
import { useState, useEffect, useMemo, useCallback } from 'react'
import { WorkspaceTab } from '../types'
import HubGrid, { HubEntry, HubFilter, filterEntries } from './HubGrid'
import { formatBinding } from '../lib/keybindings'

const PAGE_SIZE = 12
const FILTER_STORAGE_KEY = 'nest-hub-filter'

function loadFilter(): HubFilter {
  const raw = localStorage.getItem(FILTER_STORAGE_KEY)
  if (raw === 'active' || raw === 'pinned') return raw
  if (raw?.startsWith('tab:')) return { tabId: raw.slice(4) }
  return 'all'
}

function saveFilter(f: HubFilter) {
  localStorage.setItem(FILTER_STORAGE_KEY, typeof f === 'string' ? f : `tab:${f.tabId}`)
}

interface Props {
  tabs: WorkspaceTab[]
  activeTabId: string
  busyPanes: Set<string>
  onClose: () => void
  onJump: (tabId: string, paneId: string) => void
  onTogglePin: (tabId: string, paneId: string) => void
}

export default function HubOverlay({ tabs, activeTabId, busyPanes, onClose, onJump, onTogglePin }: Props) {
  const [filter, setFilter] = useState<HubFilter>(loadFilter)
  const [page, setPage] = useState(0)
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null)

  const entries = useMemo<HubEntry[]>(() =>
    tabs.flatMap(t =>
      t.panes
        .filter(p => p.aiType !== 'browser')
        .map(p => ({
          pane: p,
          tabId: t.id,
          tabName: t.name,
          isActiveTab: t.id === activeTabId,
          busy: busyPanes.has(p.id),
        }))
    ), [tabs, activeTabId, busyPanes])

  const filtered = useMemo(() => filterEntries(entries, filter), [entries, filter])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE)

  const changeFilter = useCallback((f: HubFilter) => {
    setFilter(f)
    setPage(0)
    saveFilter(f)
  }, [])

  // If the focused pane left the visible set (filter change, pane closed),
  // drop focus so Tab cycling restarts from the first tile.
  useEffect(() => {
    if (focusedPaneId && !visible.some(e => e.pane.id === focusedPaneId)) {
      setFocusedPaneId(null)
    }
  }, [visible, focusedPaneId])

  // Keyboard: Tab cycles tiles; Enter jumps to the focused pane's workspace.
  // Escape is handled centrally in App.tsx (capture phase) so overlay
  // priority lives in one place.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        if (visible.length === 0) return
        const idx = visible.findIndex(en => en.pane.id === focusedPaneId)
        const next = e.shiftKey
          ? (idx - 1 + visible.length) % visible.length
          : (idx + 1) % visible.length
        setFocusedPaneId(visible[next].pane.id)
        return
      }
      if (e.key === 'Enter' && focusedPaneId) {
        const entry = visible.find(en => en.pane.id === focusedPaneId)
        // Only when the xterm itself isn't consuming Enter (i.e. the tile is
        // focused via Tab but the user hasn't clicked into the terminal).
        if (entry && !(document.activeElement?.closest('.hub-tile-terminal'))) {
          e.preventDefault()
          onJump(entry.tabId, entry.pane.id)
        }
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [visible, focusedPaneId, onJump])

  const counts = useMemo(() => ({
    all: entries.length,
    active: entries.filter(e => e.busy).length,
    pinned: entries.filter(e => e.pane.pinned).length,
  }), [entries])

  const filterIs = (f: HubFilter) =>
    typeof f === 'string' ? filter === f : typeof filter !== 'string' && filter.tabId === f.tabId

  return (
    <div className="hub-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="hub-panel">
        <div className="hub-title">
          <span>Hub — active terminals</span>
          <span className="hub-title-hint">
            Esc back · Tab next · Enter go to workspace · {formatBinding('Meta+Shift+O')} toggle
          </span>
        </div>
        <div className="hub-toolbar">
          <button className={`hub-chip${filterIs('all') ? ' on' : ''}`} onClick={() => changeFilter('all')}>
            All <span className="hub-chip-n">{counts.all}</span>
          </button>
          <button className={`hub-chip${filterIs('active') ? ' on' : ''}`} onClick={() => changeFilter('active')}>
            Active <span className="hub-chip-n">{counts.active}</span>
          </button>
          <button className={`hub-chip${filterIs('pinned') ? ' on' : ''}`} onClick={() => changeFilter('pinned')}>
            Pinned <span className="hub-chip-n">{counts.pinned}</span>
          </button>
          <span className="hub-toolbar-sep" />
          {tabs.map(t => (
            <button
              key={t.id}
              className={`hub-chip${filterIs({ tabId: t.id }) ? ' on' : ''}`}
              onClick={() => changeFilter({ tabId: t.id })}
            >
              {t.name}
            </button>
          ))}
          {pageCount > 1 && (
            <span className="hub-pager">
              <button className="hub-chip" disabled={clampedPage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>‹</button>
              <span className="hub-pager-label">{clampedPage + 1}/{pageCount}</span>
              <button className="hub-chip" disabled={clampedPage >= pageCount - 1} onClick={() => setPage(p => p + 1)}>›</button>
            </span>
          )}
        </div>
        <HubGrid
          entries={visible}
          focusedPaneId={focusedPaneId}
          onFocus={setFocusedPaneId}
          onJump={onJump}
          onTogglePin={onTogglePin}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add CSS to the end of `src/styles/global.css`**

```css
/* ── Hub Overlay ─────────────────────────────────────────── */

.hub-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
}

.hub-panel {
  width: 100%;
  height: 100%;
  max-width: 1400px;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.75);
  overflow: hidden;
}

.hub-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  user-select: none;
}

.hub-title-hint {
  font-size: 10px;
  font-weight: 400;
  color: var(--text-muted);
}

.hub-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  user-select: none;
}

.hub-chip {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 2px 8px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.hub-chip:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.hub-chip.on {
  color: var(--raven-blue);
  background: #0066FF15;
  border-color: #0066FF30;
}

.hub-chip:disabled {
  opacity: 0.4;
  cursor: default;
}

.hub-chip-n {
  color: var(--text-muted);
  margin-left: 3px;
}

.hub-chip.on .hub-chip-n {
  color: var(--text-secondary);
}

.hub-toolbar-sep {
  width: 1px;
  height: 14px;
  background: var(--border);
  margin: 0 3px;
}

.hub-pager {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.hub-pager-label {
  font-size: 10px;
  color: var(--text-muted);
}

.hub-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  grid-auto-rows: minmax(180px, 1fr);
  gap: 6px;
  padding: 8px;
  overflow-y: auto;
}

.hub-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}

.hub-tile {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-app);
  border: 1.5px solid color-mix(in srgb, var(--pane-color, var(--border)) 40%, transparent);
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pane-color, transparent) 12%, transparent);
}

.hub-tile.focused {
  border-color: color-mix(in srgb, var(--pane-color, var(--raven-blue)) 85%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pane-color, transparent) 25%, transparent),
              0 0 12px -2px color-mix(in srgb, var(--pane-color, transparent) 45%, transparent);
}

.hub-tile-header {
  height: 26px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 8px;
  background: color-mix(in srgb, var(--pane-color, var(--bg-surface)) 8%, var(--bg-surface));
  font-size: 10px;
  user-select: none;
}

.hub-tile-header .pane-ai-label {
  font-size: 10px;
}

.hub-tile-header .pane-account-name {
  font-size: 10px;
}

.hub-tile-ws {
  font-size: 9px;
  font-weight: 600;
  font-family: 'SF Mono', 'Menlo', monospace;
  letter-spacing: 0.4px;
  color: var(--raven-blue);
  background: #0066FF15;
  border: 1px solid #0066FF30;
  border-radius: 3px;
  padding: 1px 5px;
  flex-shrink: 0;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hub-tile-busy {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22C55E;
  flex-shrink: 0;
  animation: activityPulse 1.5s ease-in-out infinite;
}

.hub-tile-spacer {
  flex: 1;
}

.hub-tile-pin {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  padding: 1px 5px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.hub-tile-pin:hover {
  color: var(--text-secondary);
  border-color: var(--border);
}

.hub-tile-pin.pinned {
  color: var(--raven-blue);
  border-color: #0066FF30;
  background: #0066FF15;
}

.hub-tile-terminal {
  flex: 1;
  min-height: 0;
  padding: 4px 6px;
  overflow: hidden;
}

/* Hub button in the tab bar (goes inside the rightSlot, no-drag zone) */
.hub-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: color 0.15s, border-color 0.15s;
  position: relative;
}

.hub-btn:hover {
  color: var(--raven-blue);
  border-color: #0066FF44;
}
```

- [ ] **Step 3: Verify type-check**

Run: `npm run build`
Expected: OK (HubOverlay not mounted yet).

- [ ] **Step 4: Commit**

```bash
git add src/components/HubOverlay.tsx src/styles/global.css
git commit -m "feat(hub): HubOverlay — filters, pagination and keyboard + styles

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Integration in `App.tsx` + Command Palette + tab bar button

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/CommandPalette.tsx`

**Interfaces:**
- Consumes: `HubOverlay` (Task 4), `kb.hubOverlay` (Task 1), `focusTerminal` (`src/terminal-registry.ts`).
- Produces: complete feature mounted.

- [ ] **Step 1: Import + state in `App.tsx`**

Import (next to the other components, ~line 27):

```ts
import HubOverlay from './components/HubOverlay'
```

State (next to `commandPaletteOpen`, ~line 102):

```ts
  const [hubOpen, setHubOpen] = useState(false)
  const hubOpenRef = useRef(false)
  hubOpenRef.current = hubOpen
  const hubPrevFocusRef = useRef<string | null>(null)
```

- [ ] **Step 2: open/close/jump/pin handlers in `App.tsx`**

After `handleTabSelect` (~line 557):

```ts
  const openHub = useCallback(() => {
    hubPrevFocusRef.current = focusedPaneIdRef.current
    setHubOpen(true)
  }, [])

  const closeHub = useCallback(() => {
    setHubOpen(false)
    const prev = hubPrevFocusRef.current
    // Restore focus after the overlay unmounts and the pane below re-renders.
    if (prev) setTimeout(() => focusTerminal(prev), 50)
  }, [])

  const handleHubJump = useCallback((tabId: string, paneId: string) => {
    setHubOpen(false)
    setActiveTabId(tabId)
    setFocusedPaneId(paneId)
    focusedPaneIdRef.current = paneId
    // The pane's xterm mounts on tab switch; focus once it registered.
    setTimeout(() => focusTerminal(paneId), 150)
  }, [])

  const handleHubTogglePin = useCallback((tabId: string, paneId: string) => {
    setTabs(prev => prev.map(t => t.id !== tabId ? t : {
      ...t,
      panes: t.panes.map(p => p.id !== paneId ? p : { ...p, pinned: !p.pinned }),
    }))
  }, [])
```

- [ ] **Step 3: Keybinding + Escape in the global handler of `App.tsx`**

In the keydown handler (~line 851), BEFORE the zoom Escape line:

```ts
      if (e.key === 'Escape' && hubOpenRef.current) { closeHub(); return }
      if (e.key === 'Escape' && zoomedPaneIdRef.current !== null) { handleUnzoom(); return }
```

And next to the search/palette bindings (~line 894):

```ts
      if (matchesBinding(e, kb.globalSearch)) { e.preventDefault(); setGlobalSearchOpen(true); return }
      if (matchesBinding(e, kb.commandPalette)) { e.preventDefault(); setCommandPaletteOpen(v => !v); return }
      if (matchesBinding(e, kb.hubOverlay)) {
        e.preventDefault()
        if (hubOpenRef.current) closeHub()
        else openHub()
        return
      }
```

The handler's `useEffect` must include `closeHub` and `openHub` in its deps array if it already lists callbacks (check the existing array and add them if appropriate; if it uses refs and `// eslint-disable`, follow the file's pattern).

- [ ] **Step 4: Mount the overlay in `App.tsx`'s render**

After the `{globalSearchOpen && (...)}` block (~line 1179):

```tsx
      {hubOpen && (
        <HubOverlay
          tabs={tabs}
          activeTabId={activeTabId}
          busyPanes={busyPanes}
          onClose={closeHub}
          onJump={handleHubJump}
          onTogglePin={handleHubTogglePin}
        />
      )}
```

- [ ] **Step 5: Hub button in the tab bar (via `rightSlot`, without touching TabBar)**

Derive remote activity (near `activePanesPayload`, ~line 974):

```ts
  const hubHasRemoteActivity = useMemo(
    () => tabs.some(t => t.id !== activeTabId && t.panes.some(p => busyPanes.has(p.id))),
    [tabs, activeTabId, busyPanes]
  )
```

Replace `rightSlot={<ResourceBar panes={activePanesPayload} />}` with:

```tsx
        rightSlot={
          <>
            <button className="hub-btn" onClick={openHub} title={`Hub (${formatBinding('Meta+Shift+O')})`}>
              Hub
              {hubHasRemoteActivity && <span className="tab-activity-dot" />}
            </button>
            <ResourceBar panes={activePanesPayload} />
          </>
        }
```

Import `formatBinding` (add to the existing import from `./lib/keybindings`):

```ts
import { matchesBinding, formatBinding } from './lib/keybindings'
```

- [ ] **Step 6: Command Palette entry**

In `src/components/CommandPalette.tsx` — add prop:

```ts
interface Props {
  // ... existing
  onBroadcastToggle: () => void
  onHubOpen: () => void
}
```

In the component's destructuring add `onHubOpen`, and in `buildItems()` after the `action-broadcast` item:

```ts
    items.push({
      id: 'action-hub', section: 'actions',
      label: 'Hub: view all terminals',
      sublabel: 'Compact view of all workspaces',
      keywords: 'hub overview terminals workspaces all',
      action: () => { onHubOpen(); onClose() },
    })
```

In `App.tsx`, in the `<CommandPalette ...>` JSX add:

```tsx
          onBroadcastToggle={() => setBroadcastMode(v => !v)}
          onHubOpen={openHub}
```

- [ ] **Step 7: Verify type-check**

Run: `npm run build`
Expected: OK, no errors.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/CommandPalette.tsx
git commit -m "feat(hub): integration — shortcut, mounted overlay, palette and tab bar button

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end manual verification + screenshots + draft PR

**Files:**
- None new (fixes that come out of testing go here, committed separately).

- [ ] **Step 1: Launch the app**

Run: `npm run dev` (in the worktree). Expected: the app opens.

- [ ] **Step 2: Manual test path (document it verbatim in the PR)**

1. Create 3 workspaces with 2 terminals each (mix Claude/plain terminal).
2. In workspace 1, leave an agent generating long output. Switch to workspace 2.
3. `Ctrl+Shift+O` → the Hub opens, the 6 terminals are visible with their workspace chip; the agent's shows the green dot and streams live.
4. Click a terminal from workspace 3 → type `echo hello` + Enter → verify the echo in the tile. Go to workspace 3 and confirm the command ran there.
5. `Esc` → returns to workspace 2 with focus on the pane that was focused before opening.
6. Reopen the Hub → double-click a tile from another workspace → jumps to that workspace with that pane focused.
7. Pin 2 terminals → the «Pinned» filter shows only those → close and reopen the app → the pins persist.
8. The «Active» filter shows only the busy ones. Per-workspace filter works. The filter is remembered when reopening the Hub.
9. Kill a process (`exit` in a shell) → its tile shows the «ended» badge.
10. Command Palette (`Ctrl+K`) → «Hub: view all terminals» opens the overlay. The tab bar's «Hub» button too, and it shows the little green dot when there's activity in a non-active workspace.
11. With >12 terminals, pagination appears and navigates correctly.
12. Regression: the active workspace's broadcast, zoom (`Ctrl+Shift+Z`), Cmd+1-9 and global search still work the same with the Hub closed.

- [ ] **Step 3: Screenshots**

Capture: (a) the Hub open with 6+ tiles and filters, (b) a focused tile receiving input, (c) the Hub button with the activity dot. Save them for the PR body.

- [ ] **Step 4: final `npm run build`**

Run: `npm run build`
Expected: OK.

- [ ] **Step 5: Push and draft PR (do NOT merge)**

```bash
git push -u origin feat/hub-overlay
gh pr create --draft --repo GeronimoDiClemente/raven-nest \
  --title "feat(hub): overlay with all the terminals from every workspace" \
  --body-file docs/superpowers/team-stats-PR-body.md
```

(The body is written by hand at that step — don't reuse the team-stats one; include: the *why*, screenshots, the manual test path from Step 2, the PTY resize decision, and the spec's checklist. Close with the "generated with Claude Code" line per convention.)

- [ ] **Step 6: Notify Matías**

Report the draft PR URL. Remember: Gero's review; ask for a Mac/Linux smoke in the body.

---

## Self-Review (done while writing the plan)

1. **Spec coverage:** entry via shortcut/palette/button ✓ (Task 5), tiles with visual language + chip ✓ (Task 3/4), filters + localStorage persistence ✓ (Task 4), session-persistent pin ✓ (Task 1), interactions (click/Tab/Enter/double click/Esc) ✓ (Task 4/5), PTY resize decision ✓ (Task 2, `canResizePty`), pagination of 12 ✓ (Task 4), 200-line replay ✓ (Task 2), ended badge ✓ (Task 3), empty state ✓ (Task 3), manual testing + build ✓ (Task 6). The spec's single subscription with fan-out was simplified to N subscriptions to the bus's `Set` (same real cost, less plumbing) — noted as a conscious deviation.
2. **Placeholders:** none; every step has concrete code or commands.
3. **Type consistency:** `HubEntry`/`HubFilter`/`filterEntries` defined in Task 3 and consumed identically in Task 4; `useHubTerminal(paneId, canResizePty)` identical between Task 2 and 3; `onJump(tabId, paneId)`/`onTogglePin(tabId, paneId)` uniform across Tasks 3/4/5.

---

## Addition (2026-07-14): Hub as a workspace from the `+` (mockup A)

Tasks 7-8, on the same branch. The overlay already exists and is reviewed. These tasks extract its core into `HubView` and add the "Hub as a tab" variant, created from the empty state of a new workspace. The Global Constraints above still apply.

### Task 7: Extract `HubView` (shared core) from `HubOverlay`

**Files:**
- Create: `src/components/HubView.tsx`
- Modify: `src/components/HubOverlay.tsx` (becomes a wrapper)
- Modify: `src/styles/global.css` (add `.hub-view`)

**Interfaces:**
- Produces (consumed by Task 8 and by HubOverlay): `<HubView tabs activeTabId activePanes onJump onTogglePin />` — the core: filter state (localStorage `nest-hub-filter`), pagination (PAGE_SIZE 12), keyboard (Tab/Shift+Tab/Enter), filter toolbar + `HubGrid`. Excludes tabs with `isHub`.

- [ ] **Step 1: Create `src/components/HubView.tsx`**

```tsx
import { useState, useEffect, useMemo, useCallback } from 'react'
import { WorkspaceTab } from '../types'
import HubGrid, { HubEntry, HubFilter, filterEntries } from './HubGrid'

const PAGE_SIZE = 12
const FILTER_STORAGE_KEY = 'nest-hub-filter'

function loadFilter(): HubFilter {
  const raw = localStorage.getItem(FILTER_STORAGE_KEY)
  if (raw === 'active' || raw === 'pinned') return raw
  if (raw?.startsWith('tab:')) return { tabId: raw.slice(4) }
  return 'all'
}
function saveFilter(f: HubFilter) {
  localStorage.setItem(FILTER_STORAGE_KEY, typeof f === 'string' ? f : `tab:${f.tabId}`)
}

interface Props {
  tabs: WorkspaceTab[]
  activeTabId: string
  activePanes: Set<string>
  onJump: (tabId: string, paneId: string) => void
  onTogglePin: (tabId: string, paneId: string) => void
}

export default function HubView({ tabs, activeTabId, activePanes, onJump, onTogglePin }: Props) {
  const [filter, setFilter] = useState<HubFilter>(loadFilter)
  const [page, setPage] = useState(0)
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null)

  // Hub tabs own no terminals; exclude them so they don't appear as empty
  // per-workspace filter chips or contribute phantom entries.
  const sourceTabs = useMemo(() => tabs.filter(t => !t.isHub), [tabs])

  const entries = useMemo<HubEntry[]>(() =>
    sourceTabs.flatMap(t =>
      t.panes
        .filter(p => p.aiType !== 'browser')
        .map(p => ({
          pane: p,
          tabId: t.id,
          tabName: t.name,
          isActiveTab: t.id === activeTabId,
          busy: activePanes.has(p.id),
        }))
    ), [sourceTabs, activeTabId, activePanes])

  const filtered = useMemo(() => filterEntries(entries, filter), [entries, filter])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE)

  const changeFilter = useCallback((f: HubFilter) => {
    setFilter(f); setPage(0); saveFilter(f)
  }, [])

  useEffect(() => {
    if (focusedPaneId && !visible.some(e => e.pane.id === focusedPaneId)) {
      setFocusedPaneId(null)
    }
  }, [visible, focusedPaneId])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        if (visible.length === 0) return
        const idx = visible.findIndex(en => en.pane.id === focusedPaneId)
        const next = e.shiftKey
          ? (idx - 1 + visible.length) % visible.length
          : (idx + 1) % visible.length
        setFocusedPaneId(visible[next].pane.id)
        return
      }
      if (e.key === 'Enter' && focusedPaneId) {
        const entry = visible.find(en => en.pane.id === focusedPaneId)
        if (entry && !(document.activeElement?.closest('.hub-tile-terminal'))) {
          e.preventDefault()
          onJump(entry.tabId, entry.pane.id)
        }
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [visible, focusedPaneId, onJump])

  const counts = useMemo(() => ({
    all: entries.length,
    active: entries.filter(e => e.busy).length,
    pinned: entries.filter(e => e.pane.pinned).length,
  }), [entries])

  const filterIs = (f: HubFilter) =>
    typeof f === 'string' ? filter === f : typeof filter !== 'string' && filter.tabId === f.tabId

  return (
    <div className="hub-view">
      <div className="hub-toolbar">
        <button className={`hub-chip${filterIs('all') ? ' on' : ''}`} onClick={() => changeFilter('all')}>
          All <span className="hub-chip-n">{counts.all}</span>
        </button>
        <button className={`hub-chip${filterIs('active') ? ' on' : ''}`} onClick={() => changeFilter('active')}>
          Active <span className="hub-chip-n">{counts.active}</span>
        </button>
        <button className={`hub-chip${filterIs('pinned') ? ' on' : ''}`} onClick={() => changeFilter('pinned')}>
          Pinned <span className="hub-chip-n">{counts.pinned}</span>
        </button>
        <span className="hub-toolbar-sep" />
        {sourceTabs.map(t => (
          <button
            key={t.id}
            className={`hub-chip${filterIs({ tabId: t.id }) ? ' on' : ''}`}
            onClick={() => changeFilter({ tabId: t.id })}
          >
            {t.name}
          </button>
        ))}
        {pageCount > 1 && (
          <span className="hub-pager">
            <button className="hub-chip" disabled={clampedPage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>‹</button>
            <span className="hub-pager-label">{clampedPage + 1}/{pageCount}</span>
            <button className="hub-chip" disabled={clampedPage >= pageCount - 1} onClick={() => setPage(p => p + 1)}>›</button>
          </span>
        )}
      </div>
      <HubGrid
        entries={visible}
        focusedPaneId={focusedPaneId}
        onFocus={setFocusedPaneId}
        onJump={onJump}
        onTogglePin={onTogglePin}
      />
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `src/components/HubOverlay.tsx` as a wrapper**

```tsx
import { WorkspaceTab } from '../types'
import HubView from './HubView'
import { formatBinding } from '../lib/keybindings'

interface Props {
  tabs: WorkspaceTab[]
  activeTabId: string
  activePanes: Set<string>
  onClose: () => void
  onJump: (tabId: string, paneId: string) => void
  onTogglePin: (tabId: string, paneId: string) => void
}

export default function HubOverlay({ tabs, activeTabId, activePanes, onClose, onJump, onTogglePin }: Props) {
  return (
    <div className="hub-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="hub-panel">
        <div className="hub-title">
          <span>Hub — active terminals</span>
          <span className="hub-title-hint">
            Esc back · Tab next · Enter go to workspace · {formatBinding('Meta+Shift+O')} toggle
          </span>
        </div>
        <HubView
          tabs={tabs}
          activeTabId={activeTabId}
          activePanes={activePanes}
          onJump={onJump}
          onTogglePin={onTogglePin}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: CSS** — at the end of `src/styles/global.css`:

```css
.hub-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 4:** `npm run build` clean. The overlay must behave identically.

- [ ] **Step 5: Commit**

```bash
git add src/components/HubView.tsx src/components/HubOverlay.tsx src/styles/global.css
git commit -m "refactor(hub): extract HubView from the overlay to reuse as a workspace

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Hub as a workspace (`isHub`) created from the empty state

**Files:**
- Modify: `src/types.ts` (`WorkspaceTab.isHub`, `SessionData.tabs[].isHub`)
- Create: `src/components/HubWorkspace.tsx`
- Modify: `src/App.tsx` (render switch, convert handler, hasAnyTerminal, EmptyState, persistence)
- Modify: `src/components/TabBar.tsx` (▦ icon)
- Modify: `src/styles/global.css` (`.hub-workspace`, `.tab-hub-icon`, `.empty-hub-btn`)

**Interfaces:**
- Consumes: `HubView` (Task 7); `handleHubJump`/`handleHubTogglePin`/`activePanes`/`updateActiveTab` (already exist in App).

- [ ] **Step 1: `src/types.ts`** — in `interface WorkspaceTab`, after `splitRatios?: Record<string, number[]>`:

```ts
  splitRatios?: Record<string, number[]>
  isHub?: boolean  // true = tab that shows the Hub (all terminals), with no panes of its own
```

and in `SessionData.tabs` (the array's object), after its `splitRatios?`:

```ts
    splitRatios?: Record<string, number[]>
    isHub?: boolean
```

- [ ] **Step 2: Create `src/components/HubWorkspace.tsx`**

```tsx
import { WorkspaceTab } from '../types'
import HubView from './HubView'

interface Props {
  tabs: WorkspaceTab[]
  activeTabId: string
  activePanes: Set<string>
  onJump: (tabId: string, paneId: string) => void
  onTogglePin: (tabId: string, paneId: string) => void
}

export default function HubWorkspace(props: Props) {
  return (
    <div className="hub-workspace">
      <HubView {...props} />
    </div>
  )
}
```

- [ ] **Step 3: `src/App.tsx` — import + hasAnyTerminal + convertActiveTabToHub**

Import next to `import HubOverlay from './components/HubOverlay'`:
```ts
import HubWorkspace from './components/HubWorkspace'
```

Near `hubHasRemoteActivity` (same `useMemo` pattern):
```ts
  const hasAnyTerminal = useMemo(
    () => tabs.some(t => !t.isHub && t.panes.some(p => p.aiType !== 'browser')),
    [tabs]
  )
```

After `handleHubTogglePin`:
```ts
  const convertActiveTabToHub = useCallback(() => {
    updateActiveTab(t => ({ ...t, isHub: true, name: 'Hub' }))
  }, [updateActiveTab])
```

- [ ] **Step 4: `src/App.tsx` — render switch** (around line 1148). Replace exactly:
```tsx
        {isInitialState ? (
          <EmptyState onNewPane={addNextPane} />
        ) : (
```
with:
```tsx
        {activeTab.isHub ? (
          <HubWorkspace
            tabs={tabs}
            activeTabId={activeTabId}
            activePanes={activePanes}
            onJump={handleHubJump}
            onTogglePin={handleHubTogglePin}
          />
        ) : isInitialState ? (
          <EmptyState
            onNewPane={addNextPane}
            onShowHub={hasAnyTerminal ? convertActiveTabToHub : undefined}
          />
        ) : (
```
The rest of the block (`<>...PaneLayoutEngine...</>` and its closing `)}`) stays the same.

- [ ] **Step 5: `src/App.tsx` — EmptyState accepts `onShowHub`** (function ~line 1398). Replace the signature `function EmptyState({ onNewPane }: { onNewPane: () => void })` with `function EmptyState({ onNewPane, onShowHub }: { onNewPane: () => void; onShowHub?: () => void })`, and before the closing `</div>` of `.empty-state` (after the `<p className="empty-hint">…</p>`) add:
```tsx
      {onShowHub && (
        <button className="empty-hub-btn" onClick={onShowHub}>
          ▦ View all terminals (Hub)
        </button>
      )}
```

- [ ] **Step 6: `src/App.tsx` — persistence.** In the save mapping (inside `tabs.map(tab => ({ ... }))`, after `splitRatios: tab.splitRatios,`):
```ts
          splitRatios: tab.splitRatios,
          isHub: tab.isHub,
```
and in `migrate` (the v3 branch that returns `layoutId`/`panes`/`splitRatios`), add `isHub: raw.isHub,` to that returned object.

- [ ] **Step 7: `src/components/TabBar.tsx`** — in `SortableTab`, inside the `<span className="tab-name" …>`, right before `{tab.name}`:
```tsx
          {tab.isHub && <span className="tab-hub-icon">▦</span>}
          {tab.name}
```

- [ ] **Step 8: CSS** — at the end of `src/styles/global.css`:
```css
.hub-workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.tab-hub-icon {
  color: var(--raven-blue);
  margin-right: 5px;
  font-size: 11px;
}

.empty-hub-btn {
  margin-top: 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: 1px solid var(--raven-blue);
  color: var(--raven-blue);
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.empty-hub-btn:hover {
  background: #0066FF18;
}
```

- [ ] **Step 9:** `npm run build` clean.

- [ ] **Step 10: Commit**

```bash
git add src/types.ts src/components/HubWorkspace.tsx src/App.tsx src/components/TabBar.tsx src/styles/global.css
git commit -m "feat(hub): create the Hub as a workspace from the +'s empty state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Verification (manual test path):** + → empty tab → "View all terminals (Hub)" converts the tab (name Hub, ▦ icon, grid with the other workspaces' terminals); typing in a tile goes to that terminal; double-click jumps to the workspace (the Hub tab stays); the `Ctrl+Shift+O` overlay is unchanged; the EmptyState button doesn't appear if there are no terminals in another workspace; close/reopen keeps the Hub tab.
