# Integrations Hub — Phase 0, Plan 2: Board wiring + Table UI + mount

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Make the Orchestration Board visible with real data — expose the branch↔ticket links, all worktrees, and the repo full name to the renderer; assemble them with `projectBoard` (Plan 1) in a `useBoardRows` hook; render an `OrchestrationBoard` (dense row list, repo design system); mount it as a new top-level "Integrations" section.

**Architecture:** Reuse existing engines. Main exposes 3 small reads over IPC. Renderer hook assembles `BoardInputs` and calls the pure `projectBoard`. Component follows the `.wt-list`/`.tk-row` dense-row pattern (no `<table>` exists in the repo). Mounted as a boolean overlay like `MyReposPanel` (no top-level section enum exists).

**Tech stack:** Electron IPC (`electron/main.ts`, `electron/preload.ts`), TS types (`src/types.ts`), React + RTL (jsdom), Vitest.

**Design tokens:** use existing CSS vars so the green rebrand (in `feat/login-redesign`) applies on merge: accent `var(--raven-blue)`, surfaces `var(--bg-surface)`/`--bg-elevated`/`--border`, text `--text-primary`/`--text-secondary`/`--text-muted`. Status dots use literal colors: needs_you `#e6a23c`, working `#d9b64e`, done `#37c98a`, todo `#6b7280`. Mono: `'SFMono-Regular','Consolas',monospace`.

---

### Task 1: Expose board data over IPC (`tickets:tracked`, `worktree:listAll`, `repo` on signals)

**Files:**
- Modify: `electron/ticket-loop.ts` (add public `trackedList()`)
- Modify: `electron/main.ts` (2 new `ipcMain.handle`; add `repo` to the signals DTO mapping if not already present)
- Modify: `electron/preload.ts` (2 new bridge methods)
- Modify: `src/types.ts` (`WorktreeSignalDTO.repo`, `TicketsBridge.tracked`, `window.worktree.listAll`)
- Test: `electron/__tests__/ticket-loop.test.ts` (add a `trackedList` case)

- [ ] **Step 1: Failing test for `trackedList`** — in `electron/__tests__/ticket-loop.test.ts`, add a test that registers a provider, calls `startWork` for a ticket/branch, then asserts `ticketLoop.trackedList()` returns `[{ branch, ticketKey }]` matching. (Mirror the existing setup in that file for registering a fake provider + deps.)

- [ ] **Step 2: Run it, verify fail** — `npx vitest run electron/__tests__/ticket-loop.test.ts` → FAIL (`trackedList is not a function`).

- [ ] **Step 3: Implement**
  - `electron/ticket-loop.ts`: add
    ```ts
    /** All tracked branch→ticket links, for the renderer board. */
    trackedList(): Array<{ branch: string; ticketKey: string }> {
      return [...this.tracked.entries()].map(([branch, t]) => ({ branch, ticketKey: t.key }))
    }
    ```
    (`this.tracked` is the existing `Map<string, Tracked>`; `Tracked.key` is the ticket key.)
  - `electron/main.ts` (near the other `tickets:*` handlers ~`:2391`):
    ```ts
    ipcMain.handle('tickets:tracked', () => ticketLoop.trackedList())
    ```
  - `electron/main.ts` (near `worktree:list` ~`:993`): add a handler returning every worktree from the store:
    ```ts
    ipcMain.handle('worktree:listAll', () => {
      try { return { ok: true, worktrees: worktreeStore.list() } }
      catch (e) { return { ok: false, error: String(e) } }
    })
    ```
    (use the same `worktreeStore` instance the `worktree:list` handler uses.)
  - Signals DTO `repo`: check the `signals:list` handler (~`main.ts:2386`) and `WorktreeSignal` in `electron/integrations/worktree-signals.ts` (it has a `repo: string | null`). Ensure the object returned to the renderer includes `repo`. If `list()` already returns the full `WorktreeSignal` (with `repo`), no main change is needed beyond the type.
  - `electron/preload.ts`:
    - in the `window.tickets` object (~`:277`): add `tracked: () => invoke('tickets:tracked'),`
    - in the `window.worktree` object (~`:325`): add `listAll: () => invoke('worktree:listAll'),`
  - `src/types.ts`:
    - `WorktreeSignalDTO`: add `repo: string | null`
    - `TicketsBridge`: add `tracked: () => Promise<Array<{ branch: string; ticketKey: string }>>`
    - the `window.worktree` interface (~`:548`): add `listAll: () => Promise<{ ok: true; worktrees: WorktreeMeta[] } | { ok: false; error: string }>`

- [ ] **Step 4: Run tests + typecheck** — `npx vitest run electron/__tests__/ticket-loop.test.ts` PASS; `npx tsc --noEmit -p tsconfig.json` (and `tsconfig.web.json`) clean for touched files.

- [ ] **Step 5: Commit** — `git commit -am "feat(hub): expose tracked links, listAll worktrees, and signal repo to the renderer"`

---

### Task 2: `useBoardRows` hook — assemble inputs, call projectBoard

**Files:**
- Create: `src/hooks/useBoardRows.ts`
- Test: `src/__tests__/hooks/useBoardRows.test.tsx`

- [ ] **Step 1: Failing test** — mock `window.tickets` (`list`, `tracked`), `window.worktree` (`listAll`), `window.signals` (`list`, `onUpdate`), render a probe that calls the hook (via `@testing-library/react` `renderHook`), and assert it returns rows from `projectBoard` for one linked ticket. Mock `useInstalledPlugins` to return `github` installed.

- [ ] **Step 2: Verify fail** — module missing.

- [ ] **Step 3: Implement**
  ```ts
  // src/hooks/useBoardRows.ts
  import { useCallback, useEffect, useState } from 'react'
  import { projectBoard, type BoardRow } from '../integrations/board'
  import { useInstalledPlugins } from './useInstalledPlugins'
  import type { Ticket, WorktreeMeta, WorktreeSignalDTO } from '../types'

  const TICKET_PLUGINS = ['jira', 'linear', 'github']

  /** Assembles the orchestration board from the live bridges. `personalLogin`
   *  tells org from personal scope (empty string → everything reads as org). */
  export function useBoardRows(personalLogin = ''): { rows: BoardRow[]; refresh: () => void } {
    const { installed } = useInstalledPlugins()
    const [rows, setRows] = useState<BoardRow[]>([])

    const refresh = useCallback(async () => {
      const w = window as unknown as {
        tickets?: { list: (id: string) => Promise<Ticket[]>; tracked: () => Promise<Array<{ branch: string; ticketKey: string }>> }
        worktree?: { listAll: () => Promise<{ ok: true; worktrees: WorktreeMeta[] } | { ok: false; error: string }> }
        signals?: { list: () => Promise<WorktreeSignalDTO[]> }
      }
      const ticketPlugins = installed.map((p) => p.id).filter((id) => TICKET_PLUGINS.includes(id))
      const perPlugin = await Promise.all(
        ticketPlugins.map(async (id) => (await w.tickets?.list(id) ?? []).map((ticket) => ({ pluginId: id, ticket }))),
      )
      const tickets = perPlugin.flat()
      const links = (await w.tickets?.tracked()) ?? []
      const wtRes = await w.worktree?.listAll()
      const worktrees = wtRes && wtRes.ok ? wtRes.worktrees : []
      const signals = (await w.signals?.list()) ?? []
      const sigByPath = new Map(signals.map((s) => [s.repoPath, s]))
      setRows(projectBoard({
        tickets, worktrees, signals, links, personalLogin,
        repoFullName: (p) => sigByPath.get(p)?.repo ?? null,
      }))
    }, [installed, personalLogin])

    useEffect(() => { void refresh() }, [refresh])
    useEffect(() => {
      const w = window as unknown as { signals?: { onUpdate?: (cb: () => void) => () => void } }
      return w.signals?.onUpdate?.(() => { void refresh() })
    }, [refresh])

    return { rows, refresh }
  }
  ```

- [ ] **Step 4: Run** — hook test PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(hub): useBoardRows — assemble board rows from live bridges"`

---

### Task 3: `OrchestrationBoard` component (dense row list)

**Files:**
- Create: `src/components/OrchestrationBoard.tsx`
- Create: `src/components/OrchestrationBoard.css` (or append rules to `src/styles/global.css` under a clearly-labelled section — prefer a co-located css imported by the component if that's the repo pattern; otherwise global.css)
- Test: `src/__tests__/components/OrchestrationBoard.test.tsx`

- [ ] **Step 1: Failing test** — render `<OrchestrationBoard rows={rows} />` with two `BoardRow`s (one `needs_you` org row with a branch, one `todo` personal row without). Assert: both titles render; the ticket keys render (mono); a status label/dot for each (`getByText('Needs You')` etc. or a `data-status` attr); the source chip shows the plugin (e.g. `GitHub`); the branch renders for the linked row; an empty-state renders when `rows=[]`.

- [ ] **Step 2: Verify fail** — component missing.

- [ ] **Step 3: Implement** — a `.ob-list` of `.ob-row`s following `WorktreesSection`'s `.wt-list`/`.wt-item` structure. Each row: status dot (`<span className={`ob-dot ob-dot-${row.status}`} />`) + label, ticket key (`.ob-key` mono), title (`.ob-title`), source chip (colored square with `pluginId[0]` + name, reading color from `BUILTIN_CATALOG` by `pluginId` — import `BUILTIN_CATALOG` from `../lib/plugins/builtinCatalog`), branch (`.ob-branch` mono, only if `row.branch`), and a scope chip only when `row.scope.kind==='org'` (`row.scope.org`). Provide `STATUS_LABEL = { needs_you:'Needs You', working:'Working', done:'Done', todo:'To do' }`. Empty state `.ob-empty` "No tasks yet — connect a source." Props: `{ rows: BoardRow[]; onOpen?: (row: BoardRow) => void }`; clicking a row calls `onOpen?.(row)`.
  - CSS: `.ob-list` flex column; `.ob-row` grid or flex with the columns, `border-bottom:1px solid var(--border)`, hover `background:var(--bg-elevated)`; `.ob-key`/`.ob-branch` mono, `color:var(--text-secondary)`; `.ob-dot` 7px circle; status colors as literals above; source chip `.ob-src` 18px rounded square `color:#fff;font-weight:700`.

- [ ] **Step 4: Run** — component test PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(hub): OrchestrationBoard — dense board row list"`

---

### Task 4: Mount as a top-level "Integrations" section

**Files:**
- Create: `src/components/IntegrationsHub.tsx` (wrapper: calls `useBoardRows`, renders header + `<OrchestrationBoard>`, full-screen `teams-workspace` shell like `MyReposPanel`)
- Modify: `src/components/Sidebar.tsx` (add an "Integrations" rail item + `onIntegrationsOpen?` prop, mirroring the "My Repos" block ~`:580-596`,`:42-44`)
- Modify: `src/App.tsx` (add `integrationsHubOpen` state + wire `onIntegrationsOpen` + conditionally mount `<IntegrationsHub onClose=... />`, mirroring `myReposOpen` ~`:194`,`:1111-1114`,`:1291-1303`)
- Test: `src/__tests__/components/IntegrationsHub.test.tsx` (render with mocked bridges → shows board header + at least one row or the empty state; a close button calls `onClose`)

- [ ] **Step 1: Failing test** for `IntegrationsHub` (mock the same `window.*` bridges as Task 2; assert header text "Integrations" + board renders).
- [ ] **Step 2: Verify fail.**
- [ ] **Step 3: Implement** `IntegrationsHub.tsx` (shell + header "Integrations · orchestration" + close button calling `onClose` + `<OrchestrationBoard rows={rows} />` from `useBoardRows()`), then the `Sidebar.tsx` item and `App.tsx` wiring. Gate behind the same plan check as My Repos if one is required (`planLimits.allowMyRepos` → reuse or add `allowIntegrations`; if unclear, mount ungated for now and note it).
- [ ] **Step 4: Run** — `npx vitest run` full suite green; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -am "feat(hub): mount Integrations orchestration section"`

---

## Self-Review
- Covers spec §5.2 (Table view + data sources) and the mount decision (§ open-q1: own top-level section). Worktrees view, connected-layer UI (scope filter/presence/jump beyond the scope chip), rail/bot, picker, Recipes → Plans 3–5.
- `repoFullName` is sourced from the signals' `repo` (added in Task 1); worktrees without a signal read as personal scope — acceptable for Phase 0, refined when presence/Teams lands (Plan 3).
- Reuses `projectBoard`, `useInstalledPlugins`, `BUILTIN_CATALOG`, the `.wt-list` pattern, and the boolean-overlay mount pattern — no new frameworks.
