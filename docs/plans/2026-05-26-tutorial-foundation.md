# Tutorial Foundation + Activation Tour — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation of the in-app interactive tutorial — a coachmark engine, a demo-mode mock harness that lets real components run against a fake backend, and the first end-to-end tour (Activation) auto-launched on first run and re-playable from a Help button.

**Architecture:** A `DemoProvider` activates a `DemoHarness` that swaps `window.*` IPC APIs, global `fetch`, and the `supabase` client for in-memory mocks (restored on cleanup). An `OnboardingTour` overlay renders dimming + spotlight + tooltip anchored to DOM elements via `data-tour-id`/CSS selectors, advancing on "Next" or on clicking the highlighted element. A `TutorialController` decides which tour to show (auto on first section mount, or via Help "?" button) and mounts the demo stage + tour together.

**Tech Stack:** React + TypeScript, Vite/electron-vite renderer, xterm.js, Vitest (jsdom project) + @testing-library/react, localStorage for per-machine "seen" flags.

**Scope of this plan (Plan 1 of a series):** foundation + Activation tour only. Follow-up plans (same spec `docs/specs/2026-05-26-tutorial-interactivo-design.md`) add the My Repos (incl. merge demo), Teams, and Worktrees tours, reusing everything built here.

**Reference spec:** `docs/specs/2026-05-26-tutorial-interactivo-design.md`

---

## File Structure

**New files (this plan):**

| File | Responsibility |
|---|---|
| `src/tutorial/types.ts` | `TourId`, `TourStep`, `TourDef` shared types. |
| `src/hooks/useTourSeen.ts` | `nest:tour-seen:<id>` localStorage flag hook. |
| `src/tutorial/demo/fixtures.ts` | In-memory demo data + mutable `DemoState`. |
| `src/tutorial/demo/mocks.ts` | Mock builders for `window.*`, `fetch`, supabase from `DemoState`. |
| `src/tutorial/demo/harness.ts` | `createDemoHarness()` — activate/deactivate (swap + restore). |
| `src/tutorial/DemoProvider.tsx` | React wrapper: activates harness on mount, deactivates on unmount. |
| `src/tutorial/DemoActivationStage.tsx` | Activation demo surface (chrome shell + real `NewPaneDialog`). |
| `src/tutorial/OnboardingTour.tsx` | Coachmark engine (overlay/spotlight/tooltip/navigation). |
| `src/tutorial/tours/activation.ts` | Activation tour step definitions. |
| `src/tutorial/TutorialController.tsx` | Orchestrates which tour is open; mounts demo stage + tour. |
| `src/tutorial/registry.ts` | Maps `TourId` → `TourDef`; helper to list tours. |

**Modified files (this plan):**

| File | Change |
|---|---|
| `src/lib/supabase.ts` | Export `supabase` as a swappable `Proxy`; add `__setSupabaseClient` / `__resetSupabaseClient`. |
| `src/App.tsx` | Mount `<TutorialController/>`; pass an `onHelp('activation')` opener to `Sidebar`; auto-launch activation on first run. |
| `src/components/Sidebar.tsx` | Add a Help "?" affordance that calls a new `onHelp?: (tourId: TourId) => void` prop. |

**Test files (this plan):**

- `src/__tests__/useTourSeen.test.ts`
- `src/__tests__/supabase-swap.test.ts`
- `src/__tests__/tutorial/harness.test.ts`
- `src/__tests__/tutorial/harness-fetch.test.ts`
- `src/__tests__/tutorial/harness-pty.test.ts`
- `src/__tests__/components/OnboardingTour.test.tsx`
- `src/__tests__/components/activation-tour.test.tsx`

**Test commands:**
- Run a single file: `npm run test -- src/__tests__/useTourSeen.test.ts`
- Run all: `npm run test`
- Typecheck: `npx tsc -b --noEmit`

---

## Task 1: Shared tutorial types

**Files:**
- Create: `src/tutorial/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// src/tutorial/types.ts

/** All tours shipped in the app. */
export type TourId = 'activation' | 'my-repos' | 'teams' | 'worktrees'

/** One coachmark step: anchor + copy + how it advances. */
export interface TourStep {
  /** Stable id, unique within a tour. */
  id: string
  /** CSS selector for the element to spotlight (e.g. `[data-tour-id="new-terminal"]`). */
  anchor: string
  /** Tooltip heading. */
  title: string
  /** Tooltip body copy. */
  body: string
  /** Preferred tooltip side relative to the anchor. Defaults to 'bottom'. */
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** If true, clicking the spotlighted element advances to the next step. */
  advanceOnClick?: boolean
}

export interface TourDef {
  id: TourId
  steps: TourStep[]
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/tutorial/types.ts
git commit -m "feat(tutorial): shared tour types"
```

---

## Task 2: `useTourSeen` hook

**Files:**
- Create: `src/hooks/useTourSeen.ts`
- Test: `src/__tests__/useTourSeen.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/useTourSeen.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTourSeen } from '../hooks/useTourSeen'

describe('useTourSeen', () => {
  beforeEach(() => localStorage.clear())

  it('starts unseen when no flag is stored', () => {
    const { result } = renderHook(() => useTourSeen('activation'))
    expect(result.current.seen).toBe(false)
  })

  it('markSeen sets the flag and persists it', () => {
    const { result } = renderHook(() => useTourSeen('activation'))
    act(() => result.current.markSeen())
    expect(result.current.seen).toBe(true)
    expect(localStorage.getItem('nest:tour-seen:activation')).toBe('1')
  })

  it('reads an existing stored flag as seen', () => {
    localStorage.setItem('nest:tour-seen:teams', '1')
    const { result } = renderHook(() => useTourSeen('teams'))
    expect(result.current.seen).toBe(true)
  })

  it('reset clears the flag', () => {
    localStorage.setItem('nest:tour-seen:teams', '1')
    const { result } = renderHook(() => useTourSeen('teams'))
    act(() => result.current.reset())
    expect(result.current.seen).toBe(false)
    expect(localStorage.getItem('nest:tour-seen:teams')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/__tests__/useTourSeen.test.ts`
Expected: FAIL — `Cannot find module '../hooks/useTourSeen'`.

- [ ] **Step 3: Write the hook**

```typescript
// src/hooks/useTourSeen.ts
import { useState, useCallback } from 'react'

const key = (tourId: string) => `nest:tour-seen:${tourId}`

/**
 * Per-machine "has the user seen this tour" flag, backed by localStorage.
 * Mirrors the existing `nest:*` key convention (e.g. `nest:remembered-email`).
 */
export function useTourSeen(tourId: string) {
  const [seen, setSeen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key(tourId)) === '1'
    } catch {
      return false
    }
  })

  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(key(tourId), '1')
    } catch {
      // localStorage unavailable (private mode); flag stays in-memory only.
    }
    setSeen(true)
  }, [tourId])

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(key(tourId))
    } catch {
      // ignore
    }
    setSeen(false)
  }, [tourId])

  return { seen, markSeen, reset }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/__tests__/useTourSeen.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTourSeen.ts src/__tests__/useTourSeen.test.ts
git commit -m "feat(tutorial): useTourSeen localStorage flag hook"
```

---

## Task 3: Swappable supabase client

The demo must intercept supabase without touching the ~7 hooks that `import { supabase }`. We keep the `supabase` export name but make it a `Proxy` forwarding to a swappable target.

**Files:**
- Modify: `src/lib/supabase.ts` (entire file, currently 6 lines)
- Test: `src/__tests__/supabase-swap.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/supabase-swap.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'

// Stub the SDK so importing the module never builds a real network client.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    __real: true,
    from: () => 'REAL_FROM',
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}))

import { supabase, __setSupabaseClient, __resetSupabaseClient } from '../lib/supabase'

afterEach(() => __resetSupabaseClient())

describe('swappable supabase', () => {
  it('forwards to the real client by default', () => {
    expect(supabase.from('x' as never)).toBe('REAL_FROM')
  })

  it('routes calls to a swapped-in mock client', () => {
    const mock = { from: () => 'MOCK_FROM', auth: { getUser: async () => ({ data: { user: { id: 'demo' } } }) } }
    __setSupabaseClient(mock as never)
    expect(supabase.from('x' as never)).toBe('MOCK_FROM')
  })

  it('restores the real client on reset', () => {
    __setSupabaseClient({ from: () => 'MOCK_FROM' } as never)
    __resetSupabaseClient()
    expect(supabase.from('x' as never)).toBe('REAL_FROM')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/__tests__/supabase-swap.test.ts`
Expected: FAIL — `__setSupabaseClient` is not exported.

- [ ] **Step 3: Rewrite `src/lib/supabase.ts`**

```typescript
// src/lib/supabase.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const realClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let activeClient: SupabaseClient = realClient

/** TEST/DEMO ONLY — point the app's `supabase` at a mock client. */
export function __setSupabaseClient(client: SupabaseClient): void {
  activeClient = client
}

/** TEST/DEMO ONLY — restore the real client. */
export function __resetSupabaseClient(): void {
  activeClient = realClient
}

/**
 * Proxy that forwards every access to whichever client is currently active.
 * Lets the tutorial swap in a mock at runtime without changing the ~dozen
 * call sites that `import { supabase }`. Functions are bound to the active
 * client so chained calls (`.from(...).select(...)`) keep their `this`.
 */
export const supabase = new Proxy(realClient, {
  get(_target, prop, receiver) {
    const value = Reflect.get(activeClient as object, prop, receiver)
    return typeof value === 'function' ? value.bind(activeClient) : value
  },
}) as SupabaseClient
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/__tests__/supabase-swap.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck (confirms existing supabase consumers still compile)**

Run: `npx tsc -b --noEmit`
Expected: PASS — no new errors from `useTeam.ts`, `useTeamChat.ts`, etc.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase.ts src/__tests__/supabase-swap.test.ts
git commit -m "refactor(supabase): swappable client proxy for demo/test interception"
```

---

## Task 4: Demo fixtures + mutable state

The single source of demo data. Mocks read/write `DemoState` so simulated actions (clone, merge, create worktree) reflect in the UI.

**Files:**
- Create: `src/tutorial/demo/fixtures.ts`

- [ ] **Step 1: Write the fixtures module**

```typescript
// src/tutorial/demo/fixtures.ts

/** A demo repo as the UI expects to see it. */
export interface DemoRepo {
  id: string
  fullName: string
  provider: 'github' | 'gitlab'
  cloneUrl: string
  /** null = not yet on disk (offers Clone / Link). */
  localPath: string | null
  defaultBranch: string
}

/** A GitHub-shaped PR for PRList/PRReview fixtures. */
export interface DemoPR {
  number: number
  title: string
  user: { login: string; avatar_url: string }
  state: 'open' | 'closed'
  merged: boolean
  created_at: string
  head: { ref: string }
  base: { ref: string }
  body: string | null
}

/** Mutable demo world. Mocks mutate this; the UI re-reads it. */
export interface DemoState {
  repos: DemoRepo[]
  prs: Record<string /* repoFullName */, DemoPR[]>
  /** Pre-recorded terminal output replayed into the demo pane. */
  ptyScript: string
  githubLogin: string
  githubToken: string
}

const AVATAR =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="10" fill="%234F9EFF"/></svg>'

/** Returns a fresh, isolated copy of the demo world (no shared references). */
export function createDemoState(): DemoState {
  return {
    githubLogin: 'demo-user',
    githubToken: 'demo-token',
    repos: [
      {
        id: 'repo-web',
        fullName: 'demo-user/nest-web',
        provider: 'github',
        cloneUrl: 'https://github.com/demo-user/nest-web.git',
        localPath: null,
        defaultBranch: 'main',
      },
      {
        id: 'repo-api',
        fullName: 'demo-user/nest-api',
        provider: 'gitlab',
        cloneUrl: 'https://gitlab.com/demo-user/nest-api.git',
        localPath: 'C:/demo/nest-api',
        defaultBranch: 'main',
      },
    ],
    prs: {
      'demo-user/nest-web': [
        {
          number: 42,
          title: 'Add dark mode toggle',
          user: { login: 'teammate', avatar_url: AVATAR },
          state: 'open',
          merged: false,
          created_at: new Date(Date.now() - 3600_000).toISOString(),
          head: { ref: 'feat/dark-mode' },
          base: { ref: 'main' },
          body: 'Adds a dark mode toggle to settings.',
        },
      ],
    },
    ptyScript:
      '\x1b[32m$\x1b[0m claude\r\n' +
      'Welcome to Claude Code (demo)\r\n' +
      '> How do I add a route?\r\n' +
      '\x1b[36mAdd a new entry to src/router.tsx ...\x1b[0m\r\n',
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/tutorial/demo/fixtures.ts
git commit -m "feat(tutorial): demo fixtures and mutable demo state"
```

---

## Task 5: Mock builders

Build fake `window.*` APIs and a fake supabase client from a `DemoState`.

**Files:**
- Create: `src/tutorial/demo/mocks.ts`

- [ ] **Step 1: Write the mocks module**

```typescript
// src/tutorial/demo/mocks.ts
import type { DemoState } from './fixtures'

/** Subset of window.pty the demo drives; matches electron/preload.ts signatures. */
type PtyDataCb = (paneId: string, data: string) => void

/** Builds a fake `window.pty` that replays `state.ptyScript` into the pane. */
export function makePtyMock(state: DemoState) {
  let dataCb: PtyDataCb | null = null
  const timers: ReturnType<typeof setTimeout>[] = []

  return {
    api: {
      create: async (paneId: string) => {
        // Replay the script in small chunks so it animates like a real PTY.
        const chunks = state.ptyScript.match(/.{1,8}/gs) ?? []
        chunks.forEach((chunk, i) => {
          timers.push(setTimeout(() => dataCb?.(paneId, chunk), 120 * (i + 1)))
        })
      },
      write: () => {},
      resize: () => {},
      kill: async () => ({ ok: true }),
      exists: async () => true,
      getBuffer: async () => state.ptyScript,
      getPid: async () => 1234,
      onData: (cb: PtyDataCb) => {
        dataCb = cb
      },
      onExit: () => {},
      removeAllListeners: () => {
        dataCb = null
      },
    },
    /** Cancel pending replay timers on teardown. */
    dispose: () => {
      timers.forEach(clearTimeout)
    },
  }
}

/** Builds fake git/worktree/accounts/etc. APIs over the demo state. */
export function makeWindowMocks(state: DemoState) {
  return {
    git: {
      info: async () => ({ ok: true, branch: 'main', clean: true }),
      status: async () => ({ ok: true, files: [] }),
      clone: async () => ({ ok: true }),
      pushBranch: async () => ({ ok: true, compareUrl: 'https://github.com/demo-user/nest-web/compare/feat/x' }),
      listBranches: async () => ({ branches: ['main', 'feat/dark-mode'], defaultBranch: 'main' }),
      pickRepoFolder: async () => 'C:/demo/picked-folder',
      getRemoteUrl: async () => 'https://github.com/demo-user/nest-web.git',
      shortstat: async () => ({ ok: true, insertions: 12, deletions: 3, files: 2 }),
      findPRForBranch: async () => ({ ok: true, pr: null }),
      listUntrackedEnvFiles: async () => [] as string[],
    },
    accounts: {
      list: async () => ['demo'],
      save: async (_t: string, name: string) => name,
      delete: async () => {},
      getDir: async () => 'C:/demo/account',
      detachConfig: async () => ({ ok: true }),
    },
    localPaths: {
      get: async (id: string) => state.repos.find((r) => r.id === id)?.localPath ?? '',
      set: async (id: string, p: string) => {
        const r = state.repos.find((x) => x.id === id)
        if (r) r.localPath = p
      },
      delete: async () => {},
      getAll: async () =>
        Object.fromEntries(state.repos.filter((r) => r.localPath).map((r) => [r.id, r.localPath as string])),
      getMigrationFlag: async () => '',
      setMigrationFlag: async () => {},
    },
    dialog: {
      openFolder: async () => 'C:/demo/picked-folder',
    },
    metrics: {
      snapshot: async () => ({ panes: [] }),
      refreshDisk: async () => ({ ok: true }),
      killPid: async () => ({ ok: true }),
      portsByPids: async () => ({}),
    },
    session: {
      load: async () => null,
      save: async () => {},
    },
    port: {
      scan: async () => [] as number[],
      listAll: async () => [] as number[],
      listForWorkspace: async () => ({}),
      byPane: async () => ({}),
    },
    electronShell: {
      openExternal: () => {},
      onDeepLink: () => {},
      consumePendingDeepLink: async () => null,
    },
  }
}

/** Minimal supabase-shaped mock: auth + from() + realtime channel no-ops. */
export function makeSupabaseMock(state: DemoState) {
  const noChain = {
    select: () => noChain,
    eq: () => noChain,
    upsert: async () => ({ data: null, error: null }),
    insert: async () => ({ data: null, error: null }),
    update: () => noChain,
    single: async () => ({ data: null, error: null }),
    order: () => noChain,
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null }),
  }
  const channel = {
    on: () => channel,
    subscribe: () => channel,
    track: async () => {},
    unsubscribe: async () => {},
    send: async () => {},
  }
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'demo', email: 'demo@nest.app' } }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => noChain,
    channel: () => channel,
    removeChannel: async () => {},
    // touch state so the param isn't unused and future actions can read it
    _state: state,
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/tutorial/demo/mocks.ts
git commit -m "feat(tutorial): window/pty/supabase mock builders"
```

---

## Task 6: Demo harness — window.* swap + restore

**Files:**
- Create: `src/tutorial/demo/harness.ts`
- Test: `src/__tests__/tutorial/harness.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/tutorial/harness.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createDemoHarness } from '../../tutorial/demo/harness'
import { createDemoState } from '../../tutorial/demo/fixtures'

describe('demo harness window swap', () => {
  beforeEach(() => {
    // Sentinel "real" APIs so we can prove they are restored and never called.
    ;(window as unknown as { git: unknown }).git = { __real: true }
    ;(window as unknown as { worktree: unknown }).worktree = { __real: true }
  })

  it('replaces window.git while active and restores it after', async () => {
    const harness = createDemoHarness(createDemoState())
    harness.activate()
    // Mock returns fixture-shaped data, not the sentinel.
    const branches = await window.git.listBranches('x')
    expect(branches.defaultBranch).toBe('main')
    expect((window as unknown as { git: { __real?: boolean } }).git.__real).toBeUndefined()

    harness.deactivate()
    expect((window as unknown as { git: { __real?: boolean } }).git.__real).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/__tests__/tutorial/harness.test.ts`
Expected: FAIL — `Cannot find module '../../tutorial/demo/harness'`.

- [ ] **Step 3: Write the harness (window swap portion; fetch + supabase added in later tasks)**

```typescript
// src/tutorial/demo/harness.ts
import { __setSupabaseClient, __resetSupabaseClient } from '../../lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DemoState } from './fixtures'
import { makeWindowMocks, makePtyMock, makeSupabaseMock } from './mocks'

/** Keys on `window` the harness overrides during the tutorial. */
const WINDOW_KEYS = [
  'git',
  'worktree',
  'pty',
  'metrics',
  'accounts',
  'session',
  'dialog',
  'localPaths',
  'port',
  'electronShell',
] as const

export interface DemoHarness {
  /** The mutable demo world the UI reads/writes. */
  readonly state: DemoState
  /** Swap real APIs for mocks. Idempotent. */
  activate(): void
  /** Restore everything swapped by activate(). Idempotent. */
  deactivate(): void
}

export function createDemoHarness(state: DemoState): DemoHarness {
  let active = false
  const saved = new Map<string, unknown>()
  let pty: ReturnType<typeof makePtyMock> | null = null

  function activate(): void {
    if (active) return
    active = true

    const win = window as unknown as Record<string, unknown>
    for (const key of WINDOW_KEYS) saved.set(key, win[key])

    const mocks = makeWindowMocks(state)
    win.git = mocks.git
    win.worktree = makeWorktreeMock(state)
    win.metrics = mocks.metrics
    win.accounts = mocks.accounts
    win.session = mocks.session
    win.dialog = mocks.dialog
    win.localPaths = mocks.localPaths
    win.port = mocks.port
    win.electronShell = mocks.electronShell

    pty = makePtyMock(state)
    win.pty = pty.api

    __setSupabaseClient(makeSupabaseMock(state) as unknown as SupabaseClient)
  }

  function deactivate(): void {
    if (!active) return
    active = false

    pty?.dispose()
    pty = null

    const win = window as unknown as Record<string, unknown>
    for (const [key, value] of saved) win[key] = value
    saved.clear()

    __resetSupabaseClient()
  }

  return { state, activate, deactivate }
}

/** worktree mock that appends created worktrees to an in-memory list. */
function makeWorktreeMock(_state: DemoState) {
  const worktrees: unknown[] = []
  return {
    list: async () => ({ ok: true, worktrees }),
    create: async (opts: { repoPath: string; branch: string }) => {
      const meta = { path: `C:/demo/wt/${opts.branch}`, branch: opts.branch, setupState: 'done' as const }
      worktrees.push(meta)
      return meta
    },
    remove: async () => ({ ok: true }),
    get: async (p: string) => ({ path: p, branch: 'demo', setupState: 'done' as const }),
    setPreset: async () => ({ ok: true }),
    copyFiles: async () => ({ ok: true }),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/__tests__/tutorial/harness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tutorial/demo/harness.ts src/__tests__/tutorial/harness.test.ts
git commit -m "feat(tutorial): demo harness window.* swap and restore"
```

---

## Task 7: Demo harness — fetch routing for GitHub/GitLab

`PRList`/`PRReview` call `fetch('https://api.github.com/...')` directly. The harness patches `window.fetch` to serve fixtures for those hosts and pass everything else through.

**Files:**
- Modify: `src/tutorial/demo/harness.ts`
- Test: `src/__tests__/tutorial/harness-fetch.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/tutorial/harness-fetch.test.ts
import { describe, it, expect } from 'vitest'
import { createDemoHarness } from '../../tutorial/demo/harness'
import { createDemoState } from '../../tutorial/demo/fixtures'

describe('demo harness fetch routing', () => {
  it('serves PR list fixtures for api.github.com and restores fetch', async () => {
    const realFetch = window.fetch
    const harness = createDemoHarness(createDemoState())
    harness.activate()

    const res = await fetch('https://api.github.com/repos/demo-user/nest-web/pulls?state=open')
    expect(res.ok).toBe(true)
    const prs = await res.json()
    expect(Array.isArray(prs)).toBe(true)
    expect(prs[0].number).toBe(42)

    harness.deactivate()
    expect(window.fetch).toBe(realFetch)
  })

  it('marks a PR merged on a PUT .../merge', async () => {
    const harness = createDemoHarness(createDemoState())
    harness.activate()
    const res = await fetch('https://api.github.com/repos/demo-user/nest-web/pulls/42/merge', { method: 'PUT' })
    const body = await res.json()
    expect(body.merged).toBe(true)
    expect(harness.state.prs['demo-user/nest-web'][0].merged).toBe(true)
    harness.deactivate()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/__tests__/tutorial/harness-fetch.test.ts`
Expected: FAIL — real fetch hits the network / returns unexpected.

- [ ] **Step 3: Add fetch routing to the harness**

Add this helper near the bottom of `src/tutorial/demo/harness.ts`:

```typescript
/** Builds a fetch replacement that answers GitHub/GitLab calls from fixtures. */
function makeFetchMock(state: DemoState, realFetch: typeof fetch): typeof fetch {
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const isGit = url.includes('api.github.com') || url.includes('gitlab.com/api')
    if (!isGit) return realFetch(input, init)

    // PUT .../pulls/:n/merge → mark merged in state.
    const mergeMatch = url.match(/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)\/merge/)
    if (mergeMatch && (init?.method ?? 'GET').toUpperCase() === 'PUT') {
      const [, repo, num] = mergeMatch
      const pr = state.prs[repo]?.find((p) => p.number === Number(num))
      if (pr) {
        pr.merged = true
        pr.state = 'closed'
      }
      return json({ merged: true, message: 'Pull Request successfully merged' })
    }

    // GET .../pulls → list.
    const listMatch = url.match(/repos\/([^/]+\/[^/]+)\/pulls/)
    if (listMatch) {
      const repo = listMatch[1]
      const wantClosed = /state=closed/.test(url)
      const all = state.prs[repo] ?? []
      return json(all.filter((p) => (wantClosed ? p.state === 'closed' : p.state === 'open')))
    }

    // GET .../repos/:owner/:repo → repo metadata.
    const repoMatch = url.match(/repos\/([^/]+\/[^/]+)(?:\?|$)/)
    if (repoMatch) {
      const r = state.repos.find((x) => x.fullName === repoMatch[1])
      return json({ default_branch: r?.defaultBranch ?? 'main' })
    }

    // Fallback: empty array (branches, reviews, files, etc.).
    return json([])
  }) as typeof fetch
}
```

Then wire it into `activate()`/`deactivate()`. In `activate()`, after the `win.electronShell = ...` line and before `__setSupabaseClient(...)`, add:

```typescript
    saved.set('fetch', window.fetch)
    window.fetch = makeFetchMock(state, saved.get('fetch') as typeof fetch)
```

In `deactivate()`, the existing restore loop already restores `fetch` because it's stored in `saved` — but `fetch` is not in `WINDOW_KEYS`, and it IS in `saved`, so the `for (const [key, value] of saved)` loop restores it. Confirm `window.fetch` is reassignable in this loop (it is, since we set it directly on `window`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/__tests__/tutorial/harness-fetch.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tutorial/demo/harness.ts src/__tests__/tutorial/harness-fetch.test.ts
git commit -m "feat(tutorial): demo harness fetch routing for github/gitlab fixtures"
```

---

## Task 8: Demo harness — PTY replay verification

Verify the pty mock replays the script through the same `onData` path the app uses (`src/pty-events.ts`).

**Files:**
- Test: `src/__tests__/tutorial/harness-pty.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/tutorial/harness-pty.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createDemoHarness } from '../../tutorial/demo/harness'
import { createDemoState } from '../../tutorial/demo/fixtures'

describe('demo harness pty replay', () => {
  it('emits the pty script through onData after create', async () => {
    vi.useFakeTimers()
    const harness = createDemoHarness(createDemoState())
    harness.activate()

    const received: string[] = []
    window.pty.onData((_paneId, data) => received.push(data))
    await window.pty.create('pane-1', 'claude', 'C:/demo/account')

    await vi.advanceTimersByTimeAsync(2000)
    expect(received.join('')).toContain('Welcome to Claude Code (demo)')

    harness.deactivate()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run test to verify it passes (mock already built in Task 5/6)**

Run: `npm run test -- src/__tests__/tutorial/harness-pty.test.ts`
Expected: PASS. If FAIL, confirm `makePtyMock` chunk-splitting regex uses the `s` flag and timers fire.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/tutorial/harness-pty.test.ts
git commit -m "test(tutorial): pty replay through onData path"
```

---

## Task 9: `OnboardingTour` engine — navigation, skip, finish

Render the tooltip and Back/Skip/Next controls and manage the current step. (Spotlight geometry + click-to-advance come in Task 10.)

**Files:**
- Create: `src/tutorial/OnboardingTour.tsx`
- Test: `src/__tests__/components/OnboardingTour.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components/OnboardingTour.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OnboardingTour } from '../../tutorial/OnboardingTour'
import type { TourStep } from '../../tutorial/types'

const steps: TourStep[] = [
  { id: 's1', anchor: '[data-tour-id="a"]', title: 'Step one', body: 'First' },
  { id: 's2', anchor: '[data-tour-id="b"]', title: 'Step two', body: 'Second' },
]

describe('OnboardingTour navigation', () => {
  it('shows the first step and a progress badge', () => {
    render(<OnboardingTour steps={steps} onClose={() => {}} />)
    expect(screen.getByText('Step one')).toBeInTheDocument()
    expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument()
  })

  it('Next advances to the second step', () => {
    render(<OnboardingTour steps={steps} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /siguiente/i }))
    expect(screen.getByText('Step two')).toBeInTheDocument()
  })

  it('Next on the last step calls onClose (finish)', () => {
    const onClose = vi.fn()
    render(<OnboardingTour steps={steps} onClose={onClose} startIndex={1} />)
    fireEvent.click(screen.getByRole('button', { name: /finalizar|terminar|listo/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Skip calls onClose immediately', () => {
    const onClose = vi.fn()
    render(<OnboardingTour steps={steps} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /saltar/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/__tests__/components/OnboardingTour.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `OnboardingTour.tsx` (navigation + tooltip; spotlight stub for now)**

```tsx
// src/tutorial/OnboardingTour.tsx
import { useState, useCallback } from 'react'
import type { TourStep } from './types'

export interface OnboardingTourProps {
  steps: TourStep[]
  onClose: () => void
  startIndex?: number
}

export function OnboardingTour({ steps, onClose, startIndex = 0 }: OnboardingTourProps) {
  const [index, setIndex] = useState(startIndex)
  const step = steps[index]
  const isLast = index === steps.length - 1

  const next = useCallback(() => {
    if (isLast) onClose()
    else setIndex((i) => i + 1)
  }, [isLast, onClose])

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  if (!step) return null

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label="Tutorial">
      <div className="tour-dim" />
      <div className="tour-tooltip" style={{ zIndex: 2001 }}>
        <span className="tour-badge">
          {index + 1} / {steps.length}
        </span>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-controls">
          <button className="tour-back" onClick={back} disabled={index === 0}>
            Atrás
          </button>
          <span className="tour-spacer" />
          <button className="tour-skip" onClick={onClose}>
            Saltar tour
          </button>
          <button className="tour-next" onClick={next}>
            {isLast ? 'Listo' : 'Siguiente →'}
          </button>
        </div>
        <div className="tour-progress">
          {steps.map((s, i) => (
            <i key={s.id} className={i === index ? 'on' : ''} />
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/__tests__/components/OnboardingTour.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tutorial/OnboardingTour.tsx src/__tests__/components/OnboardingTour.test.tsx
git commit -m "feat(tutorial): OnboardingTour navigation engine"
```

---

## Task 10: `OnboardingTour` engine — spotlight geometry + click-to-advance

Position the spotlight over the anchored element and advance when the user clicks it (for steps with `advanceOnClick`).

**Files:**
- Modify: `src/tutorial/OnboardingTour.tsx`
- Modify: `src/__tests__/components/OnboardingTour.test.tsx`
- Modify: `src/styles/global.css` (append tutorial styles)

- [ ] **Step 1: Add the failing test (append to existing test file)**

```tsx
  it('advances when the anchored element is clicked on an advanceOnClick step', () => {
    const clickSteps: TourStep[] = [
      { id: 's1', anchor: '[data-tour-id="go"]', title: 'Click it', body: 'x', advanceOnClick: true },
      { id: 's2', anchor: '[data-tour-id="b"]', title: 'Step two', body: 'y' },
    ]
    document.body.innerHTML = '<button data-tour-id="go">Go</button>'
    render(<OnboardingTour steps={clickSteps} onClose={() => {}} />)
    fireEvent.click(document.querySelector('[data-tour-id="go"]') as Element)
    expect(screen.getByText('Step two')).toBeInTheDocument()
  })
```

Add `import type { TourStep } from '../../tutorial/types'` if not already imported (it is, from Task 9).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/__tests__/components/OnboardingTour.test.tsx`
Expected: FAIL — clicking the element does not advance yet.

- [ ] **Step 3: Add spotlight + click-to-advance to `OnboardingTour.tsx`**

Replace the body of the component (keep `OnboardingTourProps`) with:

```tsx
export function OnboardingTour({ steps, onClose, startIndex = 0 }: OnboardingTourProps) {
  const [index, setIndex] = useState(startIndex)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = steps[index]
  const isLast = index === steps.length - 1

  const next = useCallback(() => {
    if (isLast) onClose()
    else setIndex((i) => i + 1)
  }, [isLast, onClose])

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // Track the anchored element's box; recompute on resize/scroll.
  useEffect(() => {
    if (!step) return
    const update = () => {
      const el = document.querySelector(step.anchor)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [step])

  // Click-to-advance: clicking the anchored element advances the step.
  useEffect(() => {
    if (!step?.advanceOnClick) return
    const el = document.querySelector(step.anchor)
    if (!el) return
    const handler = () => next()
    el.addEventListener('click', handler)
    return () => el.removeEventListener('click', handler)
  }, [step, next])

  if (!step) return null

  const pad = 6
  const spotlight = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null

  // Tooltip sits just below the spotlight (fallback: centered).
  const tooltipStyle: React.CSSProperties = spotlight
    ? { position: 'fixed', top: spotlight.top + spotlight.height + 12, left: spotlight.left, zIndex: 2001 }
    : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 2001 }

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label="Tutorial">
      <div className="tour-dim" />
      {spotlight && (
        <div
          className="tour-spotlight"
          style={{ top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height }}
        />
      )}
      <div className="tour-tooltip" style={tooltipStyle}>
        <span className="tour-badge">
          {index + 1} / {steps.length}
        </span>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        {step.advanceOnClick && <div className="tour-hint">o tocá el elemento resaltado</div>}
        <div className="tour-controls">
          <button className="tour-back" onClick={back} disabled={index === 0}>
            Atrás
          </button>
          <span className="tour-spacer" />
          <button className="tour-skip" onClick={onClose}>
            Saltar tour
          </button>
          <button className="tour-next" onClick={next}>
            {isLast ? 'Listo' : 'Siguiente →'}
          </button>
        </div>
        <div className="tour-progress">
          {steps.map((s, i) => (
            <i key={s.id} className={i === index ? 'on' : ''} />
          ))}
        </div>
      </div>
    </div>
  )
}
```

Update the imports at the top of the file to:

```tsx
import { useState, useEffect, useCallback } from 'react'
import type { TourStep } from './types'
```

- [ ] **Step 4: Append tutorial styles to `src/styles/global.css`**

```css
/* ---- Tutorial / coachmarks ---- */
.tour-overlay { position: fixed; inset: 0; z-index: 2000; }
.tour-dim { position: absolute; inset: 0; background: rgba(4,4,6,.72); backdrop-filter: saturate(.7) blur(.5px); }
.tour-spotlight {
  position: fixed; border-radius: 10px; pointer-events: none;
  box-shadow: 0 0 0 3px rgba(47,109,255,.6), 0 0 0 9999px rgba(4,4,6,.72);
  transition: top .18s ease, left .18s ease, width .18s ease, height .18s ease;
}
.tour-tooltip {
  width: 336px; background: #16161a; border: 1px solid #2b2b32; border-radius: 14px;
  padding: 16px; box-shadow: 0 18px 50px rgba(0,0,0,.55); color: #ededed;
}
.tour-badge {
  display: inline-block; font-size: 11px; font-weight: 600; color: #9cc0ff;
  background: rgba(47,109,255,.14); border: 1px solid rgba(47,109,255,.3);
  padding: 2px 9px; border-radius: 999px;
}
.tour-title { margin: 10px 0 5px; font-size: 15.5px; font-weight: 650; }
.tour-body { margin: 0; font-size: 13px; line-height: 1.5; color: #bdbdc6; }
.tour-hint { margin-top: 10px; font-size: 11.5px; color: #7f8694; }
.tour-controls { display: flex; align-items: center; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid #232329; }
.tour-spacer { flex: 1; }
.tour-back { font-size: 12.5px; color: #5a5a63; background: #1a1a1f; border: 1px solid #26262c; border-radius: 8px; padding: 7px 12px; cursor: pointer; }
.tour-back:disabled { cursor: not-allowed; opacity: .6; }
.tour-skip { background: none; border: none; color: #7f8694; font-size: 12.5px; cursor: pointer; }
.tour-next { font-size: 12.5px; font-weight: 600; color: #fff; background: #2f6dff; border: none; border-radius: 8px; padding: 7px 15px; cursor: pointer; }
.tour-progress { display: flex; gap: 5px; margin-top: 14px; justify-content: center; }
.tour-progress i { width: 7px; height: 7px; border-radius: 50%; background: #2a2a30; display: block; }
.tour-progress i.on { background: #2f6dff; }
.tour-help-btn { background: none; border: 1px solid #2b2b32; color: #9a9aa3; border-radius: 8px; width: 26px; height: 26px; cursor: pointer; font-size: 14px; }
.tour-help-btn:hover { color: #ededed; border-color: #3a3a42; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- src/__tests__/components/OnboardingTour.test.tsx`
Expected: PASS (5 tests). jsdom returns a zero `DOMRect`; the spotlight still renders and the click handler still binds, so the click-advance test passes.

- [ ] **Step 6: Commit**

```bash
git add src/tutorial/OnboardingTour.tsx src/__tests__/components/OnboardingTour.test.tsx src/styles/global.css
git commit -m "feat(tutorial): spotlight geometry and click-to-advance"
```

---

## Task 11: Activation tour definition + registry

**Files:**
- Create: `src/tutorial/tours/activation.ts`
- Create: `src/tutorial/registry.ts`

- [ ] **Step 1: Write the activation tour**

```typescript
// src/tutorial/tours/activation.ts
import type { TourDef } from '../types'

export const activationTour: TourDef = {
  id: 'activation',
  steps: [
    {
      id: 'new-terminal',
      anchor: '[data-tour-id="new-terminal"]',
      title: 'Creá tu primer pane',
      body: 'Cada pane es una terminal con un AI corriendo (Claude, Gemini, Codex…). Empezá creando el primero.',
      placement: 'bottom',
      advanceOnClick: true,
    },
    {
      id: 'ai-grid',
      anchor: '[data-tour-id="ai-grid"]',
      title: 'Elegí un AI',
      body: 'Seleccioná qué asistente correr en este pane. Cada uno usa su propia cuenta y color.',
      placement: 'right',
      advanceOnClick: true,
    },
    {
      id: 'account',
      anchor: '[data-tour-id="account-field"]',
      title: 'Conectá una cuenta',
      body: 'La primera vez creás una cuenta para el AI; después queda guardada y la reusás entre panes.',
      placement: 'bottom',
    },
    {
      id: 'link-repo',
      anchor: '[data-tour-id="link-repo"]',
      title: 'Linkeá un repo',
      body: 'Asociá una carpeta de proyecto al workspace para que el AI trabaje sobre tu código.',
      placement: 'right',
    },
    {
      id: 'tabs',
      anchor: '[data-tour-id="workspace-tabs"]',
      title: 'Workspaces en tabs',
      body: 'Guardá distintos layouts de panes como workspaces y cambiá entre ellos desde las tabs de arriba. ¡Listo para empezar! Después explorá My Repos, Teams y Worktrees desde la barra lateral.',
      placement: 'bottom',
    },
  ],
}
```

- [ ] **Step 2: Write the registry**

```typescript
// src/tutorial/registry.ts
import type { TourDef, TourId } from './types'
import { activationTour } from './tours/activation'

/** All registered tours. Follow-up plans add my-repos / teams / worktrees here. */
const tours: Record<string, TourDef> = {
  [activationTour.id]: activationTour,
}

export function getTour(id: TourId): TourDef | undefined {
  return tours[id]
}

export function listTourIds(): TourId[] {
  return Object.keys(tours) as TourId[]
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/tutorial/tours/activation.ts src/tutorial/registry.ts
git commit -m "feat(tutorial): activation tour definition and tour registry"
```

---

## Task 12: `DemoProvider` + `DemoActivationStage`

`DemoProvider` activates the harness for its subtree; `DemoActivationStage` is the activation demo surface: a thin chrome shell (titlebar + sidebar + tabs) reusing the real `NewPaneDialog`, with `data-tour-id` anchors matching the activation tour.

**Files:**
- Create: `src/tutorial/DemoProvider.tsx`
- Create: `src/tutorial/DemoActivationStage.tsx`

- [ ] **Step 1: Write `DemoProvider.tsx`**

```tsx
// src/tutorial/DemoProvider.tsx
import { useRef, useState, useEffect, type ReactNode } from 'react'
import { createDemoHarness, type DemoHarness } from './demo/harness'
import { createDemoState } from './demo/fixtures'

interface DemoProviderProps {
  children: ReactNode
}

/**
 * Activates the demo harness (swaps window.*/fetch/supabase for mocks) while
 * mounted, and restores everything on unmount. Children render only after the
 * harness is active so they never hit a real backend.
 */
export function DemoProvider({ children }: DemoProviderProps) {
  const harnessRef = useRef<DemoHarness | null>(null)
  const [ready, setReady] = useState(false)

  if (!harnessRef.current) {
    harnessRef.current = createDemoHarness(createDemoState())
  }

  useEffect(() => {
    const harness = harnessRef.current!
    harness.activate()
    setReady(true)
    return () => {
      harness.deactivate()
      setReady(false)
    }
  }, [])

  if (!ready) return null
  return <>{children}</>
}
```

- [ ] **Step 2: Write `DemoActivationStage.tsx`**

```tsx
// src/tutorial/DemoActivationStage.tsx
import { useState } from 'react'
import NewPaneDialog from '../components/NewPaneDialog'

/**
 * High-fidelity demo surface for the activation tour. Replicates the app chrome
 * with the real global.css classes and mounts the REAL NewPaneDialog so the
 * coachmark anchors point at genuine UI. All actions are inert (demo only).
 */
export function DemoActivationStage() {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="demo-stage" style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'var(--bg, #0b0b0c)' }}>
      <div className="titlebar" style={{ height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderBottom: '1px solid #1b1b20' }}>
        <div data-tour-id="workspace-tabs" style={{ display: 'flex', gap: 6, marginLeft: 14 }}>
          <span className="tb-tab" style={{ fontSize: 11, color: '#b9bcc4', background: '#17171b', border: '1px solid #24242a', padding: '3px 12px', borderRadius: '7px 7px 0 0' }}>Workspace</span>
          <span className="tb-tab add" style={{ color: '#6b6b74' }}>+</span>
        </div>
      </div>

      <div style={{ position: 'absolute', left: 0, top: 36, bottom: 0, width: 54, borderRight: '1px solid #1b1b20', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, paddingTop: 16 }}>
        <div data-tour-id="link-repo" className="sb-ico" style={{ width: 26, height: 26, borderRadius: 7, background: '#1a1a1f', border: '1px solid #24242a' }} />
        <div className="sb-ico" style={{ width: 26, height: 26, borderRadius: 7, background: '#1a1a1f', border: '1px solid #24242a', opacity: .5 }} />
      </div>

      <div style={{ position: 'absolute', left: 54, right: 0, top: 36, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <div className="logo" style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(150deg,#2f6dff,#7c3aed)' }} />
        <div style={{ fontSize: 26, fontWeight: 700 }}>Nest</div>
        <button
          data-tour-id="new-terminal"
          className="btn-newterm"
          onClick={() => setDialogOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 14, fontWeight: 600, color: '#fff', background: '#2f6dff', border: 'none', borderRadius: 11, padding: '12px 20px', cursor: 'pointer' }}
        >
          <span style={{ fontSize: 17 }}>+</span> New Terminal
        </button>
      </div>

      {dialogOpen && (
        <div data-tour-id="ai-grid">
          <NewPaneDialog
            onConfirm={() => setDialogOpen(false)}
            onCancel={() => setDialogOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
```

> NOTE during implementation: open the real `NewPaneDialog` and confirm where the account input lives, then add `data-tour-id="account-field"` to that input inside `NewPaneDialog.tsx` (a one-line attribute add). This is the only `data-tour-id` edit to a real component in this plan; record it in the commit.

- [ ] **Step 3: Add `data-tour-id="account-field"` to NewPaneDialog**

Open `src/components/NewPaneDialog.tsx`, find the account-name `<input>`, and add `data-tour-id="account-field"` to it. (Read the file first; add the attribute to the existing account input element.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tutorial/DemoProvider.tsx src/tutorial/DemoActivationStage.tsx src/components/NewPaneDialog.tsx
git commit -m "feat(tutorial): DemoProvider and activation demo stage"
```

---

## Task 13: `TutorialController` + App/Sidebar wiring

`TutorialController` owns "which tour is open", mounts the demo stage + `OnboardingTour`, and marks the tour seen on close. It auto-launches `activation` on first run and exposes an imperative open via a global custom event (so the Help button can trigger it without prop-drilling).

**Files:**
- Create: `src/tutorial/TutorialController.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Write `TutorialController.tsx`**

```tsx
// src/tutorial/TutorialController.tsx
import { useState, useEffect, useCallback } from 'react'
import { OnboardingTour } from './OnboardingTour'
import { DemoProvider } from './DemoProvider'
import { DemoActivationStage } from './DemoActivationStage'
import { getTour } from './registry'
import { useTourSeen } from '../hooks/useTourSeen'
import type { TourId } from './types'

/** Fire to open a tour imperatively: window.dispatchEvent(new CustomEvent('nest:open-tour', { detail: 'activation' })) */
const OPEN_EVENT = 'nest:open-tour'

export function openTour(id: TourId): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }))
}

export function TutorialController() {
  const [openId, setOpenId] = useState<TourId | null>(null)
  const activation = useTourSeen('activation')

  // Auto-launch activation on first run.
  useEffect(() => {
    if (!activation.seen) setOpenId('activation')
  }, [activation.seen])

  // Imperative open (Help buttons).
  useEffect(() => {
    const handler = (e: Event) => setOpenId((e as CustomEvent<TourId>).detail)
    window.addEventListener(OPEN_EVENT, handler)
    return () => window.removeEventListener(OPEN_EVENT, handler)
  }, [])

  const close = useCallback(() => {
    if (openId === 'activation') activation.markSeen()
    setOpenId(null)
  }, [openId, activation])

  if (!openId) return null
  const tour = getTour(openId)
  if (!tour) return null

  return (
    <DemoProvider>
      {openId === 'activation' && <DemoActivationStage />}
      <OnboardingTour steps={tour.steps} onClose={close} />
    </DemoProvider>
  )
}
```

- [ ] **Step 2: Mount it in `App.tsx`**

Read `src/App.tsx`. Add the import near the other component imports:

```tsx
import { TutorialController } from './tutorial/TutorialController'
```

Render `<TutorialController />` once, as the last child of the app's root element (so its overlay sits above everything). Example — add just before the closing root wrapper tag:

```tsx
      <TutorialController />
```

- [ ] **Step 3: Add a Help opener to the Sidebar**

Read `src/components/Sidebar.tsx`. Add to its `Props`:

```tsx
  onHelp?: (tourId: import('../tutorial/types').TourId) => void
```

Add a Help "?" button in the sidebar footer (near the existing controls) that calls it:

```tsx
        {onHelp && (
          <button className="tour-help-btn" title="Tutorial" onClick={() => onHelp('activation')}>?</button>
        )}
```

In `App.tsx`, pass the prop to `<Sidebar ... />`:

```tsx
        onHelp={(id) => openTour(id)}
```

…and add `openTour` to the existing tutorial import:

```tsx
import { TutorialController, openTour } from './tutorial/TutorialController'
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual smoke (build renderer)**

Run: `npm run dev` (or the project's renderer dev command), clear `localStorage` key `nest:tour-seen:activation`, reload. Expected: activation tour auto-opens over a demo stage; Next walks all 5 steps; clicking "New Terminal" opens the real dialog and advances; clicking the "?" reopens the tour.

- [ ] **Step 6: Commit**

```bash
git add src/tutorial/TutorialController.tsx src/App.tsx src/components/Sidebar.tsx
git commit -m "feat(tutorial): TutorialController with auto-launch and Help opener"
```

---

## Task 14: Integration + "no real API" guard tests

Prove the activation tour runs end-to-end in demo mode and that no real `window.*`/`fetch`/supabase call escapes the harness.

**Files:**
- Create: `src/__tests__/components/activation-tour.test.tsx`

- [ ] **Step 1: Write the integration test**

```tsx
// src/__tests__/components/activation-tour.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TutorialController, openTour } from '../../tutorial/TutorialController'

describe('activation tour end-to-end (demo mode)', () => {
  beforeEach(() => {
    localStorage.clear()
    // Sentinel real APIs that must NEVER be called during the tour.
    ;(window as unknown as { git: unknown }).git = { listBranches: vi.fn(() => { throw new Error('real git called') }) }
    ;(window as unknown as { fetch: unknown }).fetch = vi.fn(() => { throw new Error('real fetch called') })
  })

  it('auto-launches on first run and walks every step via Next', async () => {
    render(<TutorialController />)
    await waitFor(() => expect(screen.getByText('Creá tu primer pane')).toBeInTheDocument())

    // Next through all 5 steps; the last button says "Listo".
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: /siguiente/i }))
    }
    expect(screen.getByText(/Workspaces en tabs/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /listo/i }))

    // Marked seen → does not re-open.
    await waitFor(() => expect(screen.queryByText('Creá tu primer pane')).not.toBeInTheDocument())
    expect(localStorage.getItem('nest:tour-seen:activation')).toBe('1')
  })

  it('Help opener re-launches the tour after it was seen', async () => {
    localStorage.setItem('nest:tour-seen:activation', '1')
    render(<TutorialController />)
    expect(screen.queryByText('Creá tu primer pane')).not.toBeInTheDocument()
    openTour('activation')
    await waitFor(() => expect(screen.getByText('Creá tu primer pane')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test -- src/__tests__/components/activation-tour.test.tsx`
Expected: PASS. If the sentinel `git.listBranches` throws, the harness swap is not covering it — fix `activate()` before proceeding.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `npm run test`
Run: `npx tsc -b --noEmit`
Expected: all green, no new type errors.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/components/activation-tour.test.tsx
git commit -m "test(tutorial): activation tour end-to-end and no-real-API guard"
```

---

## Self-Review (completed by plan author)

**Spec coverage (Plan 1 portion):**
- Coachmark engine (overlay/spotlight/tooltip/non-blocking Next + click-to-advance) → Tasks 9–10. ✅
- `useTourSeen` (`nest:tour-seen:<id>`) → Task 2. ✅
- DemoProvider + harness (window.*/fetch/supabase swap + restore) + fixtures → Tasks 4–8, 12. ✅
- Auto-launch first time + Help "?" opener → Task 13. ✅
- `data-tour-id` anchors → Task 12 (activation) / Task 13. ✅
- Activation tour (first-win flow) → Task 11. ✅
- Web-ready core (no Electron import in the demo tree except behind mocks; pty simulated) → satisfied: components read `window.*`, which the harness owns; `DemoActivationStage`/`OnboardingTour` import no node/electron modules. ✅
- **Deferred to follow-up plans (same spec):** My Repos tour + merge demo, Teams tour, Worktrees tour, and the `data-tour-id` edits + Help buttons inside `MyReposPanel`/`TeamsWorkspace`/`WorktreesSection`. The harness fetch-merge route and `prs` fixtures are already built here so the merge demo plugs in directly.

**Placeholder scan:** No TBD/TODO in code steps; the two implementation NOTEs (account-field anchor location, App root insertion point) require reading a file first and are explicit one-line edits, not vague instructions. ✅

**Type consistency:** `TourStep`/`TourDef`/`TourId` (Task 1) used identically in Tasks 9–13; `DemoState`/`DemoRepo`/`DemoPR` (Task 4) consumed in Tasks 5–7; `createDemoHarness(state)`/`DemoHarness.activate/deactivate/state` consistent across Tasks 6–8, 12; `OnboardingTourProps` (`steps`, `onClose`, `startIndex`) consistent Tasks 9–10, 13; `openTour`/`OPEN_EVENT` consistent Task 13–14. ✅

**z-index:** app max is 1000 (`.team-switcher-dropdown`); tutorial overlay uses 2000 and tooltip 2001, demo stage 1500 — above everything. ✅

---

## Deuda y seguimiento post-implementación

Resultado de los code-reviews tras implementar Plan 1. **Aprobado para merge, sin issues críticos.** Items diferidos:

**Para el plan de Teams (cuando el mock de supabase se ejercite con componentes reales):**
- El mock `noChain` en `src/tutorial/demo/mocks.ts` resuelve vía `.then` a `{ data: [], error: null }` pero `.single()` resuelve a `{ data: null, error: null }` — shapes inconsistentes. Verificar contra los hooks reales de Teams (`useTeam`, `useTeamChat`, etc.) y alinear el shape al que esos hooks esperan.

**Polish (próximo sprint, no bloqueante):**
- `src/__tests__/setup-dom.ts` lee la instancia jsdom vía `globalThis['jsdom']` (API interna de Vitest). Si Vitest cambia ese path, los tests que dependen del `localStorage` real de jsdom se romperían en silencio. Alternativa más robusta: instalar un mock de `localStorage` incondicional (como hace `useTourSeen.test.tsx`).
- `DemoActivationStage.tsx`: el ancla `[data-tour-id="ai-grid"]` envuelve todo `NewPaneDialog`, así que el spotlight del paso 2 abarca un área enorme. Mover el ancla a un elemento más específico dentro del diálogo.
- `OnboardingTour.tsx`: el campo `placement` de `TourStep` está declarado pero no se consume (el tooltip siempre va debajo). Implementar `placement` si algún ancla queda cerca del borde inferior (p.ej. `workspace-tabs`) y el tooltip se corta.

**Hecho en esta tanda:** `aria-label="Open tutorial"` agregado al botón Help del Sidebar (a11y).
