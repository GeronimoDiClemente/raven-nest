# Hub Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay "Hub" (`Ctrl/Cmd+Shift+O`) que muestra en grilla todas las terminales vivas de todos los workspaces y permite escribir en cualquiera; `Esc` vuelve al pane previo.

**Architecture:** La grilla (`HubGrid`) es un componente puro reutilizable; el contenedor (`HubOverlay`) es un estado de UI en `App` (mismo patrón que CommandPalette/GlobalSearch). Cada tile monta su propio xterm conectado al PTY existente por `paneId` vía `subscribeToPtyData` + `getBuffer` — nunca crea ni mata PTYs. Spec: `docs/superpowers/specs/2026-07-14-hub-overlay-design.md`.

**Tech Stack:** Electron + Vite + React + TypeScript (strict), xterm.js (`@xterm/xterm` + `@xterm/addon-fit`), node-pty ya existente en main. **Sin dependencias nuevas.**

## Global Constraints

- Rama: `feat/hub-overlay` (worktree `C:\Users\matia\raven-nest-wt\feat-hub-overlay`). **PROHIBIDO** pushear a `main` o mergear; el entregable final es un PR draft para review de Gero.
- TypeScript strict: `npm run build` debe pasar limpio después de CADA tarea (es el type-gate del repo; no hay suite de tests automatizada — CONTRIBUTING pide ejercitar la feature en la app real con `npm run dev` y documentar el test path manual).
- Estilos: solo tokens existentes (`--raven-blue`, `--bg-*`, `--border`, `--text-*`, `--pane-color`). Cero colores nuevos hardcodeados (salvo los ya presentes en el codebase, p. ej. `#22C55E` del activity dot, referenciados tal cual).
- Reglas duras de convivencia con el código existente:
  - **NUNCA** llamar `registerPane()` desde el Hub (es un `Map` de callback único por pane: pisaría el callback del `TerminalPane` del workspace activo). Usar `subscribeToPtyData()`.
  - **NUNCA** llamar `registerTerminal()` desde el Hub (pisaría la instancia del pane real en el registry de GlobalSearch).
  - **NUNCA** matar PTYs al desmontar tiles (`term.dispose()` sí, `pty.kill` jamás).
  - Resize de PTY: solo el tile enfocado y solo si su pane NO pertenece al tab activo (esos panes están montados a tamaño real detrás del overlay).
- Panes `aiType === 'browser'` quedan fuera del Hub (no tienen PTY).
- Commits: estilo del repo, cortos e imperativos, con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

- Create: `src/hooks/useHubTerminal.ts` — xterm liviano para tiles (replay + stream + input; sin search/weblinks/registry).
- Create: `src/components/HubTile.tsx` — tile individual (header + xterm + pin + ended).
- Create: `src/components/HubGrid.tsx` — grilla pura + tipos `HubEntry`/`HubFilter` + `filterEntries()`.
- Create: `src/components/HubOverlay.tsx` — contenedor overlay (filtros, paginación, teclado, foco).
- Modify: `src/types.ts` — `pinned?: boolean` en `PaneNode` (línea ~40) y `SessionPane` (línea ~220).
- Modify: `src/lib/keybindings.ts` — binding `hubOverlay`.
- Modify: `src/components/CommandPalette.tsx` — prop `onHubOpen` + item de acción.
- Modify: `src/App.tsx` — estado `hubOpen`, handlers, keybind, botón en tab bar, persistencia de `pinned`.
- Modify: `src/styles/global.css` — sección `/* ── Hub Overlay ── */` al final.

---

### Task 1: Tipos, keybinding y persistencia de `pinned`

**Files:**
- Modify: `src/types.ts` (interfaces `PaneNode` y `SessionPane`)
- Modify: `src/lib/keybindings.ts` (interface `Keybindings` + `DEFAULT_SETTINGS`)
- Modify: `src/App.tsx` (mapeo de save de sesión, ~línea 819)

**Interfaces:**
- Produces: `PaneNode.pinned?: boolean`, `SessionPane.pinned?: boolean`, `kb.hubOverlay` (binding `'Meta+Shift+O'` → Ctrl en Win/Linux, ⌘ en Mac). `sessionToPane` ya spreadea `...sp`, así que `pinned` fluye solo en el restore.

- [ ] **Step 1: Agregar `pinned` a `PaneNode`**

En `src/types.ts`, dentro de `interface PaneNode` (después de `shellId?: string`):

```ts
  shellId?: string      // terminal panes only: which shell to spawn (Windows shell picker)
  pinned?: boolean      // Hub: user-pinned pane, shows under the "Pinned" filter
```

- [ ] **Step 2: Agregar `pinned` a `SessionPane`**

En `src/types.ts`, dentro de `interface SessionPane` (después de `url?: string`):

```ts
  url?: string  // browser only: last navigated URL, restored on session load
  pinned?: boolean  // Hub pin — survives session restore
```

- [ ] **Step 3: Persistir `pinned` en el save de sesión**

En `src/App.tsx`, en el `useEffect` de save (~línea 819), el mapeo `panes: tab.panes.map(p => ({ ... }))` — agregar después de `shellId: p.shellId,`:

```ts
            shellId: p.shellId,
            pinned: p.pinned,
```

(El restore no necesita cambios: `sessionToPane` hace `...sp`.)

- [ ] **Step 4: Agregar keybinding `hubOverlay`**

En `src/lib/keybindings.ts`:

```ts
export interface Keybindings {
  voiceInput: string
  newPane: string
  globalSearch: string
  commandPalette: string
  hubOverlay: string
  nextPane: string
  // ... resto igual
```

y en `DEFAULT_SETTINGS.keybindings`, después de `commandPalette: 'Meta+k',`:

```ts
    commandPalette: 'Meta+k',
    hubOverlay: 'Meta+Shift+O',
```

Nota: `useSettings` mergea `{ ...DEFAULT_SETTINGS.keybindings, ...s.keybindings }`, así que settings guardados viejos toman el default automáticamente.

- [ ] **Step 5: Verificar type-check**

Run: `npm run build`
Expected: build OK, sin errores TS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/lib/keybindings.ts src/App.tsx
git commit -m "feat(hub): pinned en PaneNode/SessionPane + keybinding hubOverlay

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Hook `useHubTerminal`

**Files:**
- Create: `src/hooks/useHubTerminal.ts`

**Interfaces:**
- Consumes: `subscribeToPtyData` (`src/pty-events.ts:35`), `window.pty.getBuffer/write/resize`.
- Produces: `useHubTerminal(paneId: string, canResizePty: boolean): { containerRef: React.RefObject<HTMLDivElement>, focusTile: () => void }`. `canResizePty` = el pane NO pertenece al tab activo.

- [ ] **Step 1: Crear el hook completo**

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

- [ ] **Step 2: Verificar type-check**

Run: `npm run build`
Expected: OK (el hook aún no se usa; no debe romper nada).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useHubTerminal.ts
git commit -m "feat(hub): useHubTerminal — xterm liviano adosado a PTY existente

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `HubGrid` (tipos + filtro puro + grilla) y `HubTile`

**Files:**
- Create: `src/components/HubGrid.tsx`
- Create: `src/components/HubTile.tsx`

**Interfaces:**
- Consumes: `useHubTerminal(paneId, canResizePty)` (Task 2), `PaneNode`/`AI_CONFIG` de `../types`.
- Produces (usados por Task 4):
  - `interface HubEntry { pane: PaneNode; tabId: string; tabName: string; isActiveTab: boolean; busy: boolean }`
  - `type HubFilter = 'all' | 'active' | 'pinned' | { tabId: string }`
  - `function filterEntries(entries: HubEntry[], filter: HubFilter): HubEntry[]`
  - `<HubGrid entries focusedPaneId onFocus onJump onTogglePin />`

- [ ] **Step 1: Crear `src/components/HubGrid.tsx`**

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
    return <div className="hub-empty">No hay terminales para este filtro</div>
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

- [ ] **Step 2: Crear `src/components/HubTile.tsx`**

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
  // resize their PTY from a tile (see spec: "tamaño del PTY").
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
          title={pane.pinned ? 'Quitar pin' : 'Pinear al Hub'}
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

- [ ] **Step 3: Verificar type-check**

Run: `npm run build`
Expected: OK. (Las clases CSS todavía no existen — se agregan en Task 4; no afecta el build.)

- [ ] **Step 4: Commit**

```bash
git add src/components/HubGrid.tsx src/components/HubTile.tsx
git commit -m "feat(hub): HubGrid + HubTile — grilla reutilizable de terminales

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `HubOverlay` (filtros, paginación, teclado) + CSS

**Files:**
- Create: `src/components/HubOverlay.tsx`
- Modify: `src/styles/global.css` (nueva sección al final del archivo)

**Interfaces:**
- Consumes: `HubEntry`, `HubFilter`, `filterEntries`, `HubGrid` (Task 3); `WorkspaceTab` de `../types`.
- Produces (consumido por Task 5): `<HubOverlay tabs activeTabId busyPanes onClose onJump onTogglePin />` con `onJump: (tabId: string, paneId: string) => void`, `onTogglePin: (tabId: string, paneId: string) => void`.

- [ ] **Step 1: Crear `src/components/HubOverlay.tsx`**

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
          <span>Hub — terminales activas</span>
          <span className="hub-title-hint">
            Esc volver · Tab siguiente · Enter ir al workspace · {formatBinding('Meta+Shift+O')} toggle
          </span>
        </div>
        <div className="hub-toolbar">
          <button className={`hub-chip${filterIs('all') ? ' on' : ''}`} onClick={() => changeFilter('all')}>
            Todas <span className="hub-chip-n">{counts.all}</span>
          </button>
          <button className={`hub-chip${filterIs('active') ? ' on' : ''}`} onClick={() => changeFilter('active')}>
            Activas <span className="hub-chip-n">{counts.active}</span>
          </button>
          <button className={`hub-chip${filterIs('pinned') ? ' on' : ''}`} onClick={() => changeFilter('pinned')}>
            Pineadas <span className="hub-chip-n">{counts.pinned}</span>
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

- [ ] **Step 2: Agregar CSS al final de `src/styles/global.css`**

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

/* Botón Hub en la tab bar (va dentro del rightSlot, zona no-drag) */
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

- [ ] **Step 3: Verificar type-check**

Run: `npm run build`
Expected: OK (HubOverlay aún sin montar).

- [ ] **Step 4: Commit**

```bash
git add src/components/HubOverlay.tsx src/styles/global.css
git commit -m "feat(hub): HubOverlay — filtros, paginación y teclado + estilos

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Integración en `App.tsx` + Command Palette + botón en tab bar

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/CommandPalette.tsx`

**Interfaces:**
- Consumes: `HubOverlay` (Task 4), `kb.hubOverlay` (Task 1), `focusTerminal` (`src/terminal-registry.ts`).
- Produces: feature completa montada.

- [ ] **Step 1: Import + estado en `App.tsx`**

Import (junto a los otros components, ~línea 27):

```ts
import HubOverlay from './components/HubOverlay'
```

Estado (junto a `commandPaletteOpen`, ~línea 102):

```ts
  const [hubOpen, setHubOpen] = useState(false)
  const hubOpenRef = useRef(false)
  hubOpenRef.current = hubOpen
  const hubPrevFocusRef = useRef<string | null>(null)
```

- [ ] **Step 2: Handlers open/close/jump/pin en `App.tsx`**

Después de `handleTabSelect` (~línea 557):

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

- [ ] **Step 3: Keybinding + Escape en el handler global de `App.tsx`**

En el handler de keydown (~línea 851), ANTES de la línea del Escape de zoom:

```ts
      if (e.key === 'Escape' && hubOpenRef.current) { closeHub(); return }
      if (e.key === 'Escape' && zoomedPaneIdRef.current !== null) { handleUnzoom(); return }
```

Y junto a los bindings de search/palette (~línea 894):

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

El `useEffect` del handler debe incluir `closeHub` y `openHub` en su array de deps si ya lista callbacks (verificar el array existente y sumarlos si corresponde; si usa refs y `// eslint-disable`, seguir el patrón del archivo).

- [ ] **Step 4: Montar el overlay en el render de `App.tsx`**

Después del bloque `{globalSearchOpen && (...)}` (~línea 1179):

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

- [ ] **Step 5: Botón Hub en la tab bar (via `rightSlot`, sin tocar TabBar)**

Derivar actividad remota (cerca de `activePanesPayload`, ~línea 974):

```ts
  const hubHasRemoteActivity = useMemo(
    () => tabs.some(t => t.id !== activeTabId && t.panes.some(p => busyPanes.has(p.id))),
    [tabs, activeTabId, busyPanes]
  )
```

Reemplazar `rightSlot={<ResourceBar panes={activePanesPayload} />}` por:

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

Import de `formatBinding` (sumar al import existente de `./lib/keybindings`):

```ts
import { matchesBinding, formatBinding } from './lib/keybindings'
```

- [ ] **Step 6: Entrada en Command Palette**

En `src/components/CommandPalette.tsx` — agregar prop:

```ts
interface Props {
  // ... existentes
  onBroadcastToggle: () => void
  onHubOpen: () => void
}
```

En la destructuración del componente sumar `onHubOpen`, y en `buildItems()` después del item `action-broadcast`:

```ts
    items.push({
      id: 'action-hub', section: 'actions',
      label: 'Hub: ver todas las terminales',
      sublabel: 'Vista compacta de todos los workspaces',
      keywords: 'hub overview terminales workspaces todas',
      action: () => { onHubOpen(); onClose() },
    })
```

En `App.tsx`, en el JSX de `<CommandPalette ...>` agregar:

```tsx
          onBroadcastToggle={() => setBroadcastMode(v => !v)}
          onHubOpen={openHub}
```

- [ ] **Step 7: Verificar type-check**

Run: `npm run build`
Expected: OK sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/CommandPalette.tsx
git commit -m "feat(hub): integración — atajo, overlay montado, palette y botón en tab bar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Verificación manual end-to-end + screenshots + PR draft

**Files:**
- Ninguno nuevo (fixes que surjan del testeo van acá, commiteados por separado).

- [ ] **Step 1: Levantar la app**

Run: `npm run dev` (en el worktree). Expected: app abre.

- [ ] **Step 2: Test path manual (documentarlo tal cual en el PR)**

1. Crear 3 workspaces con 2 terminales c/u (mezclar Claude/terminal plano).
2. En workspace 1, dejar un agente generando output largo. Cambiar a workspace 2.
3. `Ctrl+Shift+O` → el Hub abre, se ven las 6 terminales con su chip de workspace; la del agente muestra el punto verde y streamea en vivo.
4. Click en una terminal del workspace 3 → tipear `echo hola` + Enter → verificar el eco en el tile. Ir al workspace 3 y confirmar que el comando corrió ahí.
5. `Esc` → vuelve al workspace 2 con el foco en el pane que estaba enfocado antes de abrir.
6. Reabrir Hub → doble click en un tile de otro workspace → salta a ese workspace con ese pane enfocado.
7. Pinear 2 terminales → filtro «Pineadas» muestra solo esas → cerrar y reabrir la app → los pins persisten.
8. Filtro «Activas» muestra solo las busy. Filtro por workspace funciona. Filtro queda recordado al reabrir el Hub.
9. Matar un proceso (`exit` en un shell) → su tile muestra el badge «ended».
10. Command Palette (`Ctrl+K`) → «Hub: ver todas las terminales» abre el overlay. Botón «Hub» de la tab bar también, y muestra el puntito verde cuando hay actividad en un workspace no activo.
11. Con >12 terminales, aparece paginación y navega bien.
12. Regresión: el broadcast del workspace activo, zoom (`Ctrl+Shift+Z`), Cmd+1-9 y la búsqueda global siguen funcionando igual con el Hub cerrado.

- [ ] **Step 3: Screenshots**

Capturar: (a) Hub abierto con 6+ tiles y filtros, (b) tile enfocado recibiendo input, (c) botón Hub con activity dot. Guardarlas para el body del PR.

- [ ] **Step 4: `npm run build` final**

Run: `npm run build`
Expected: OK.

- [ ] **Step 5: Push y PR draft (NO mergear)**

```bash
git push -u origin feat/hub-overlay
gh pr create --draft --repo GeronimoDiClemente/raven-nest \
  --title "feat(hub): overlay con todas las terminales de todos los workspaces" \
  --body-file docs/superpowers/team-stats-PR-body.md
```

(El body se escribe a mano en ese paso — no reusar el de team-stats; incluir: el *why*, screenshots, el test path manual del Step 2, la decisión de resize de PTY, y el checklist del spec. Cerrar con la línea de generado con Claude Code según convención.)

- [ ] **Step 6: Avisar a Matías**

Reportar URL del PR draft. Recordar: review de Gero; pedir smoke en Mac/Linux en el body.

---

## Self-Review (hecho al escribir el plan)

1. **Cobertura del spec:** entrada por atajo/palette/botón ✓ (Task 5), tiles con lenguaje visual + chip ✓ (Task 3/4), filtros + persistencia localStorage ✓ (Task 4), pin persistente en sesión ✓ (Task 1), interacciones (click/Tab/Enter/doble click/Esc) ✓ (Task 4/5), decisión resize PTY ✓ (Task 2, `canResizePty`), paginación 12 ✓ (Task 4), replay 200 líneas ✓ (Task 2), badge ended ✓ (Task 3), estado vacío ✓ (Task 3), testing manual + build ✓ (Task 6). Suscripción única con fan-out del spec se simplificó a N suscripciones al `Set` del bus (mismo costo real, menos plumbing) — anotado como desvío consciente.
2. **Placeholders:** ninguno; todos los pasos tienen código o comandos concretos.
3. **Consistencia de tipos:** `HubEntry`/`HubFilter`/`filterEntries` definidos en Task 3 y consumidos idénticos en Task 4; `useHubTerminal(paneId, canResizePty)` idéntico entre Task 2 y 3; `onJump(tabId, paneId)`/`onTogglePin(tabId, paneId)` uniformes en Tasks 3/4/5.
