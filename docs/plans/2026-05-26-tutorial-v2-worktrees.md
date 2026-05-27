# Tutorial v2 — Worktrees (secciones reales en demo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first interactive tutorial section — Worktrees — by mounting the REAL Worktrees components in an isolated demo sandbox (mocks injected via `bridge`, the user's real session untouched), guided by coachmarks.

**Architecture:** A `TutorialSandbox` overlay mounts the real `WorktreesSection` + `NewWorktreeModal` + `DiffViewerPanel` (+ optional `PortsBanner`) with demo props. Those components are migrated to read APIs through `bridge.*`; the demo harness sets `bridge` overrides so only the sandbox sees mocks (the background app uses `window.*` directly and is unaffected). Worktrees does NOT swap supabase, so the previous `maybeSingle` crash cannot recur. Coachmarks reuse the existing `OnboardingTour`.

**Tech Stack:** React + TypeScript, electron-vite renderer, Vitest (jsdom project) + @testing-library/react.

**Reference spec:** `docs/specs/2026-05-26-tutorial-v2-secciones-reales-demo-design.md`

---

## File Structure

**New files:**
| File | Responsibility |
|---|---|
| `src/tutorial/TutorialSandbox.tsx` | Full-screen overlay: activates a demo harness, mounts the real Worktrees components with demo props, renders `OnboardingTour`. |
| `src/tutorial/tours/worktrees.ts` | The Worktrees tour step definitions. |
| `src/tutorial/demo/worktree-fixtures.ts` | Worktrees/diff/ports/PR demo data + a small mutable demo worktree store. |

**Modified files:**
| File | Change |
|---|---|
| `src/tutorial/demo/harness.ts` | `createDemoHarness(state, opts?)` — supabase/fetch become opt-in. |
| `src/tutorial/demo/mocks.ts` | Add `spotlight`, `preset`, `diff` mocks; richer `worktree` mock driven by the worktree store. |
| `src/tutorial/demo/fixtures.ts` | Add worktree demo fields to `DemoState`. |
| `src/tutorial/registry.ts` | Register the `worktrees` tour. |
| `src/components/WorktreesSection.tsx` | `window.*` → `bridge.*` + `data-tour-id`. |
| `src/components/NewWorktreeModal.tsx` | `window.*` → `bridge.*` + `data-tour-id`. |
| `src/components/DiffViewerPanel.tsx` | `window.*` → `bridge.*` + `data-tour-id`. |
| `src/components/PortsBanner.tsx` | `window.*` → `bridge.*` + `data-tour-id`. |
| `src/components/SettingsPanel.tsx` | Add a `'tutorial'` tab that launches the sandbox. |
| `src/components/Sidebar.tsx` | Remove the `?` Help button; add first-time auto-launch of the Worktrees tutorial. |
| `src/App.tsx` | Mount `<TutorialSandbox>` controller; drop the old `openTour('activation')` wiring. |

**Removed files (Plan 1 cleanup):**
- `src/tutorial/DemoActivationStage.tsx`
- `src/tutorial/tours/activation.ts`
- `src/tutorial/TutorialController.tsx` (replaced by sandbox controller logic in App)
- Their tests if any reference removed exports.

**Test command:** `npm run test -- <file>` ; full suite `npm run test` ; typecheck `npx tsc -b --noEmit`.

---

## Phase 1 — Demo infrastructure

### Task 1: Selective harness (supabase/fetch opt-in)

**Files:**
- Modify: `src/tutorial/demo/harness.ts`
- Test: `src/__tests__/tutorial/harness-opts.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/tutorial/harness-opts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/supabase', () => ({
  __setSupabaseClient: vi.fn(),
  __resetSupabaseClient: vi.fn(),
}))

import { __setSupabaseClient } from '../../lib/supabase'
import { createDemoHarness } from '../../tutorial/demo/harness'
import { createDemoState } from '../../tutorial/demo/fixtures'

describe('selective harness', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does NOT swap supabase by default', () => {
    const h = createDemoHarness(createDemoState())
    h.activate()
    expect(__setSupabaseClient).not.toHaveBeenCalled()
    h.deactivate()
  })

  it('swaps supabase only when opts.supabase is true', () => {
    const h = createDemoHarness(createDemoState(), { supabase: true })
    h.activate()
    expect(__setSupabaseClient).toHaveBeenCalledTimes(1)
    h.deactivate()
  })

  it('does NOT patch window.fetch by default', () => {
    const realFetch = window.fetch
    const h = createDemoHarness(createDemoState())
    h.activate()
    expect(window.fetch).toBe(realFetch)
    h.deactivate()
  })
})
```

- [ ] **Step 2: Run → FAIL**

Run: `npm run test -- src/__tests__/tutorial/harness-opts.test.ts`
Expected: FAIL (supabase swapped unconditionally / fetch patched unconditionally).

- [ ] **Step 3: Edit `src/tutorial/demo/harness.ts`**

Add an options type and gate supabase + fetch. Read the file; then:

1. Add above `createDemoHarness`:
```typescript
export interface DemoHarnessOptions {
  /** Swap the supabase client for a mock (only sections that use Teams need this). Default false. */
  supabase?: boolean
  /** Patch window.fetch to serve GitHub/GitLab fixtures. Default false. */
  fetch?: boolean
}
```
2. Change the signature to:
```typescript
export function createDemoHarness(state: DemoState, opts: DemoHarnessOptions = {}): DemoHarness {
```
3. In `activate()`, wrap the fetch patch in `if (opts.fetch) { ... }` and the supabase swap in `if (opts.supabase) { ... }`. The `bridge` overrides and pty mock stay unconditional.
4. In `deactivate()`, only restore fetch if it was patched (existing `fetchPatched` guard already covers this), and only call `__resetSupabaseClient()` if `opts.supabase` was set — track it with a module-local `let supabaseSwapped = false` set in activate and checked in deactivate.

- [ ] **Step 4: Run → PASS**

Run: `npm run test -- src/__tests__/tutorial/harness-opts.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Fix existing harness-fetch test (it now needs opts.fetch)**

`src/__tests__/tutorial/harness-fetch.test.ts` constructs `createDemoHarness(createDemoState())` and expects fetch interception. Update both `createDemoHarness(createDemoState())` calls in that file to `createDemoHarness(createDemoState(), { fetch: true })`. Run it → PASS (2 tests).

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc -b --noEmit
git add src/tutorial/demo/harness.ts src/__tests__/tutorial/harness-opts.test.ts src/__tests__/tutorial/harness-fetch.test.ts
git commit -m "refactor(tutorial): supabase/fetch interception is opt-in per harness" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Worktree demo fixtures + mutable store

**Files:**
- Create: `src/tutorial/demo/worktree-fixtures.ts`
- Modify: `src/tutorial/demo/fixtures.ts`

- [ ] **Step 1: Create `src/tutorial/demo/worktree-fixtures.ts`**

```typescript
// src/tutorial/demo/worktree-fixtures.ts

/** Minimal worktree shape the components read (subset of the app's WorktreeMeta). */
export interface DemoWorktree {
  repoPath: string
  branch: string
  setupState: 'idle' | 'running' | 'done' | 'error'
  isRoot: boolean
}

export interface DiffHunk {
  header: string
  lines: string[]
}
export interface DiffFile {
  path: string
  additions: number
  deletions: number
  binary: boolean
  hunks: DiffHunk[]
}

/** Mutable worktree world the worktree mocks read/write. */
export interface WorktreeDemoState {
  rootRepoPath: string
  worktrees: DemoWorktree[]
  branches: string[]
  defaultBranch: string
  /** diff keyed by worktree repoPath */
  diffs: Record<string, DiffFile[]>
  /** declared ports keyed by worktree repoPath */
  ports: Record<string, number[]>
  /** PR keyed by branch */
  prs: Record<string, { number: number; url: string }>
}

export function createWorktreeDemoState(): WorktreeDemoState {
  const root = 'C:/demo/nest-web'
  const featPath = 'C:/demo/.worktrees/nest-web/feat-dark-mode'
  return {
    rootRepoPath: root,
    branches: ['main', 'feat/dark-mode'],
    defaultBranch: 'main',
    worktrees: [
      { repoPath: root, branch: 'main', setupState: 'done', isRoot: true },
      { repoPath: featPath, branch: 'feat/dark-mode', setupState: 'done', isRoot: false },
    ],
    diffs: {
      [featPath]: [
        {
          path: 'src/theme.ts',
          additions: 8,
          deletions: 1,
          binary: false,
          hunks: [
            { header: '@@ -1,3 +1,10 @@', lines: ['+export const dark = { bg: "#0b0b0c" }', '-export const theme = light', '+export const theme = dark'] },
          ],
        },
      ],
    },
    ports: { [featPath]: [5173] },
    prs: { 'feat/dark-mode': { number: 42, url: 'https://github.com/demo-user/nest-web/pull/42' } },
  }
}
```

- [ ] **Step 2: Wire it into `DemoState`**

In `src/tutorial/demo/fixtures.ts`: import `createWorktreeDemoState` and type `WorktreeDemoState`, add `worktree: WorktreeDemoState` to the `DemoState` interface, and set `worktree: createWorktreeDemoState()` in `createDemoState()`.

```typescript
import { createWorktreeDemoState, type WorktreeDemoState } from './worktree-fixtures'
// in DemoState interface:
  worktree: WorktreeDemoState
// in createDemoState() return object:
  worktree: createWorktreeDemoState(),
```

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc -b --noEmit
git add src/tutorial/demo/worktree-fixtures.ts src/tutorial/demo/fixtures.ts
git commit -m "feat(tutorial): worktree demo fixtures (worktrees/diff/ports/PR)" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: spotlight / preset / diff mocks + worktree store-driven mock

**Files:**
- Modify: `src/tutorial/demo/mocks.ts`
- Modify: `src/tutorial/demo/harness.ts`
- Test: `src/__tests__/tutorial/worktree-mocks.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/tutorial/worktree-mocks.test.ts
import { describe, it, expect, vi } from 'vitest'
import { makeWorktreeMocks } from '../../tutorial/demo/mocks'
import { createDemoState } from '../../tutorial/demo/fixtures'

describe('worktree demo mocks', () => {
  it('list returns the demo worktrees', async () => {
    const state = createDemoState()
    const m = makeWorktreeMocks(state)
    const res = await m.worktree.list(state.worktree.rootRepoPath)
    expect(res).toMatchObject({ ok: true })
    expect((res as { worktrees: unknown[] }).worktrees.length).toBe(2)
  })

  it('create adds a worktree and transitions running -> done', async () => {
    vi.useFakeTimers()
    const state = createDemoState()
    const m = makeWorktreeMocks(state)
    const meta = await m.worktree.create({ repoPath: state.worktree.rootRepoPath, branch: 'feat/new' })
    expect(meta.branch).toBe('feat/new')
    expect(state.worktree.worktrees.some(w => w.branch === 'feat/new')).toBe(true)
    await vi.advanceTimersByTimeAsync(1500)
    expect(state.worktree.worktrees.find(w => w.branch === 'feat/new')?.setupState).toBe('done')
    vi.useRealTimers()
  })

  it('remove deletes the worktree from the store', async () => {
    const state = createDemoState()
    const m = makeWorktreeMocks(state)
    const target = state.worktree.worktrees[1].repoPath
    await m.worktree.remove(target)
    expect(state.worktree.worktrees.some(w => w.repoPath === target)).toBe(false)
  })

  it('diff.get returns the demo diff for a worktree', async () => {
    const state = createDemoState()
    const m = makeWorktreeMocks(state)
    const featPath = state.worktree.worktrees[1].repoPath
    const d = await m.diff.get(featPath)
    expect(d.files[0].path).toBe('src/theme.ts')
  })
})
```

- [ ] **Step 2: Run → FAIL** (`makeWorktreeMocks` not exported)

Run: `npm run test -- src/__tests__/tutorial/worktree-mocks.test.ts`

- [ ] **Step 3: Add `makeWorktreeMocks` to `src/tutorial/demo/mocks.ts`**

Append this exported builder (it returns the worktree-domain APIs the components call: `worktree`, `git` subset, `preset`, `spotlight`, `diff`, `port`, `pty`, `electronShell`). Use the real preload signatures.

```typescript
import type { DemoState } from './fixtures'

export function makeWorktreeMocks(state: DemoState) {
  const ws = state.worktree
  const meta = (w: { repoPath: string; branch: string; setupState: string }) => ({
    repoPath: w.repoPath,
    branch: w.branch,
    setupState: w.setupState,
  })
  let setupCb: ((p: string, s: string) => void) | null = null

  return {
    worktree: {
      list: async () => ({ ok: true as const, worktrees: ws.worktrees.map(meta) }),
      get: async (p: string) => {
        const w = ws.worktrees.find((x) => x.repoPath === p)
        return w ? meta(w) : null
      },
      create: async (opts: { repoPath: string; branch: string; path?: string; presetId?: string }) => {
        const path = opts.path ?? `C:/demo/.worktrees/nest-web/${opts.branch.replace(/\//g, '-')}`
        const w = { repoPath: path, branch: opts.branch, setupState: 'running' as const, isRoot: false }
        ws.worktrees.push(w)
        // transition running -> done
        setTimeout(() => {
          const live = ws.worktrees.find((x) => x.repoPath === path)
          if (live) live.setupState = 'done'
          setupCb?.(path, 'done')
        }, 1200)
        return meta(w)
      },
      remove: async (p: string) => {
        const i = ws.worktrees.findIndex((x) => x.repoPath === p)
        if (i >= 0) ws.worktrees.splice(i, 1)
      },
      copyFiles: async () => ({ copied: 0, skipped: 0, errors: [] as string[] }),
    },
    git: {
      shortstat: async (p: string) => {
        const files = ws.diffs[p] ?? []
        return {
          additions: files.reduce((a, f) => a + f.additions, 0),
          deletions: files.reduce((a, f) => a + f.deletions, 0),
          filesChanged: files.length,
        }
      },
      listBranches: async () => ({ branches: ws.branches, defaultBranch: ws.defaultBranch }),
      findPRForBranch: async (_r: string, branch: string) => ws.prs[branch] ?? null,
      listUntrackedEnvFiles: async () => ['.env', '.env.local'],
      pushBranch: async (p: string) => {
        const w = ws.worktrees.find((x) => x.repoPath === p)
        return { ok: true as const, branch: w?.branch ?? 'demo', compareUrl: 'https://github.com/demo-user/nest-web/compare/feat/dark-mode' }
      },
    },
    preset: {
      list: async () => [] as unknown[],
      onSetupState: (cb: (p: string, s: string) => void) => { setupCb = cb },
      cancel: async () => {},
      removeListeners: () => { setupCb = null },
    },
    spotlight: {
      start: async () => {},
      stop: async () => {},
      status: async () => ({ active: false }),
      onStatus: () => {},
      removeListeners: () => {},
    },
    diff: {
      get: async (p: string) => {
        const files = ws.diffs[p] ?? []
        return { base: ws.defaultBranch, files, oversized: false }
      },
    },
    port: {
      scan: async () => [] as number[],
    },
    pty: {
      getPid: async () => 4321,
    },
    electronShell: {
      openExternal: () => {},
      onDeepLink: () => {},
      consumePendingDeepLink: async () => null,
    },
  }
}
```

> NOTE during implementation: open each of the 4 Worktrees components and confirm the exact return shape each method's caller destructures (e.g. `shortstat` → `{ additions, deletions }`, `diff.get` → `{ files, base, oversized?, binary? }`). Adjust the mock return shapes to match what the components actually read, so they render without runtime errors. The signatures above come from the preload but the components may read a subset.

- [ ] **Step 4: Run → PASS** (4 tests)

Run: `npm run test -- src/__tests__/tutorial/worktree-mocks.test.ts`

- [ ] **Step 5: Wire worktree mocks into the harness bridge overrides**

In `src/tutorial/demo/harness.ts` `activate()`, merge `makeWorktreeMocks(state)` into the `__setBridgeOverrides({...})` object (so `bridge.worktree/git/preset/spotlight/diff/port/pty/electronShell` resolve to these). The worktree-domain mocks take precedence for those keys over the generic `makeWindowMocks`. Import `makeWorktreeMocks`.

```typescript
const wt = makeWorktreeMocks(state)
__setBridgeOverrides({
  ...makeWindowMocks(state),
  ...wt,
  pty: pty.api, // keep pty replay from makePtyMock; or merge wt.pty.getPid into it
})
```
Ensure `pty` keeps both the replay (`onData`/`create` from `makePtyMock`) AND `getPid` — merge: `pty: { ...pty.api, getPid: wt.pty.getPid }`.

- [ ] **Step 6: Run harness tests + typecheck + commit**

```bash
npm run test -- src/__tests__/tutorial/
npx tsc -b --noEmit
git add src/tutorial/demo/mocks.ts src/tutorial/demo/harness.ts src/__tests__/tutorial/worktree-mocks.test.ts
git commit -m "feat(tutorial): worktree/preset/spotlight/diff demo mocks driven by store" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Migrate the 4 Worktrees components to `bridge`

Each task: add `import { bridge } from '../lib/bridge'`, replace ONLY the listed `window.<api>` tokens with `bridge.<api>` (preserve `?.`, args, awaits), add the `data-tour-id` attributes, keep `window.addEventListener`/DOM as-is. `bridge` is typed `Window & typeof globalThis`, so types are unchanged.

### Task 4: Migrate `WorktreesSection.tsx`

**Files:** Modify `src/components/WorktreesSection.tsx`

- [ ] **Step 1: Replace these `window.*` with `bridge.*`** (read the file; replace every occurrence):
  - `window.spotlight` → `bridge.spotlight` (status, onStatus, start, stop)
  - `window.worktree` → `bridge.worktree` (list, remove)
  - `window.preset` → `bridge.preset` (onSetupState, cancel)
  - `window.git` → `bridge.git` (shortstat, findPRForBranch, pushBranch)
  - `window.electronShell` → `bridge.electronShell` (openExternal)
  - Add `import { bridge } from '../lib/bridge'` at the top.

- [ ] **Step 2: Add `data-tour-id` anchors:**
  - `.wt-section-header` → add `data-tour-id="wt-header"`
  - the `+`/new button (`onClick={onNewClick}`) → add `data-tour-id="wt-add"`
  - `.wt-list` → add `data-tour-id="wt-list"`
  - the first `.wt-diff-chip` and `.wt-pr-chip` → add `data-tour-id="wt-diff-chip"` / `data-tour-id="wt-pr-chip"` (on the rendered chip element)
  - `.wt-context-menu` → add `data-tour-id="wt-context-menu"`

- [ ] **Step 3: Verify no migrated `window.<api>` token remains** (grep the file for `window.spotlight`/`window.worktree`/`window.preset`/`window.git`/`window.electronShell` → zero), `window.addEventListener` untouched.

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc -b --noEmit
git add src/components/WorktreesSection.tsx
git commit -m "refactor(tutorial): WorktreesSection reads via bridge + tour anchors" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5: Migrate `NewWorktreeModal.tsx`

**Files:** Modify `src/components/NewWorktreeModal.tsx`

- [ ] **Step 1: Replace** `window.preset`→`bridge.preset` (list), `window.git`→`bridge.git` (listBranches, listUntrackedEnvFiles), `window.worktree`→`bridge.worktree` (create, copyFiles). Add `import { bridge } from '../lib/bridge'`.
- [ ] **Step 2: Add `data-tour-id`:** modal root `.new-worktree-modal` → `data-tour-id="wt-modal"`; branch input → `data-tour-id="wt-branch-input"`; preset cards `.preset-cards` → `data-tour-id="wt-presets"`; `.wt-env-banner` → `data-tour-id="wt-env-banner"`; Create button → `data-tour-id="wt-create-btn"`.
- [ ] **Step 3:** grep confirms no migrated `window.<api>` remains.
- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc -b --noEmit
git add src/components/NewWorktreeModal.tsx
git commit -m "refactor(tutorial): NewWorktreeModal reads via bridge + tour anchors" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6: Migrate `DiffViewerPanel.tsx`

**Files:** Modify `src/components/DiffViewerPanel.tsx`

- [ ] **Step 1:** Replace `window.diff`→`bridge.diff` (get). Add `import { bridge } from '../lib/bridge'`.
- [ ] **Step 2:** Add `data-tour-id`: `.diff-panel` → `data-tour-id="diff-panel"`; `.diff-files` → `data-tour-id="diff-files"`.
- [ ] **Step 3:** grep confirms no `window.diff` remains.
- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc -b --noEmit
git add src/components/DiffViewerPanel.tsx
git commit -m "refactor(tutorial): DiffViewerPanel reads via bridge + tour anchors" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 7: Migrate `PortsBanner.tsx`

**Files:** Modify `src/components/PortsBanner.tsx`

- [ ] **Step 1:** Replace `window.worktree`→`bridge.worktree` (list), `window.pty`→`bridge.pty` (getPid), `window.port`→`bridge.port` (scan), `window.electronShell`→`bridge.electronShell` (openExternal). Add `import { bridge } from '../lib/bridge'`.
- [ ] **Step 2:** Add `data-tour-id="ports-banner"` to `.ports-banner`.
- [ ] **Step 3:** grep confirms no migrated `window.<api>` remains.
- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc -b --noEmit
git add src/components/PortsBanner.tsx
git commit -m "refactor(tutorial): PortsBanner reads via bridge + tour anchors" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Sandbox, tour, entry, cleanup

### Task 8: `TutorialSandbox` overlay

**Files:** Create `src/tutorial/TutorialSandbox.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/tutorial/TutorialSandbox.tsx
import { useRef, useState, useEffect } from 'react'
import { createDemoHarness, type DemoHarness } from './demo/harness'
import { createDemoState, type DemoState } from './demo/fixtures'
import { OnboardingTour } from './OnboardingTour'
import { getTour } from './registry'
import { WorktreesSection } from '../components/WorktreesSection'
import { NewWorktreeModal } from '../components/NewWorktreeModal'
import { DiffViewerPanel } from '../components/DiffViewerPanel'
import type { TourId } from './types'

interface Props {
  tourId: TourId
  onClose: () => void
}

/**
 * Full-screen overlay that runs a tutorial section in demo mode: activates a
 * (selective) demo harness so the mounted REAL components read mocks via bridge,
 * then renders those components + the coachmark tour. The background app is
 * untouched (it uses window.* directly). Worktrees does NOT swap supabase.
 */
export function TutorialSandbox({ tourId, onClose }: Props) {
  const harnessRef = useRef<DemoHarness | null>(null)
  const [ready, setReady] = useState(false)
  const stateRef = useRef<DemoState | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [diffPath, setDiffPath] = useState<string | null>(null)

  if (!harnessRef.current) {
    stateRef.current = createDemoState()
    // Worktrees needs no supabase/fetch — keep them off for isolation.
    harnessRef.current = createDemoHarness(stateRef.current, { supabase: false, fetch: false })
  }

  useEffect(() => {
    const h = harnessRef.current!
    h.activate()
    setReady(true)
    return () => {
      h.deactivate()
      setReady(false)
    }
  }, [])

  if (!ready) return null
  const tour = getTour(tourId)
  if (!tour) return null
  const repoPath = stateRef.current!.worktree.rootRepoPath

  return (
    <div className="tutorial-sandbox" style={{ position: 'fixed', inset: 0, zIndex: 1900, background: '#0b0b0c', display: 'flex' }}>
      {/* Left panel mimics the real sidebar wrapper using the real CSS classes */}
      <div className="sidebar expanded" style={{ width: 280, borderRight: '1px solid #1b1b20', overflow: 'auto' }}>
        <div className="sidebar-worktrees-wrap">
          <WorktreesSection
            repoPath={repoPath}
            activeRepoPath={repoPath}
            onSelect={(p) => setDiffPath(p)}
            onNewClick={() => setModalOpen(true)}
          />
        </div>
      </div>
      <div className="workspace" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b6b74' }}>
        Tutorial: Worktrees
      </div>

      <NewWorktreeModal
        open={modalOpen}
        repoPath={repoPath}
        onClose={() => setModalOpen(false)}
        onCreated={() => setModalOpen(false)}
      />
      <DiffViewerPanel open={diffPath !== null} worktreePath={diffPath} onClose={() => setDiffPath(null)} />

      <OnboardingTour steps={tour.steps} onClose={onClose} />
    </div>
  )
}
```

> NOTE during implementation: confirm the real CSS class for the sidebar wrapper (`sidebar`, `sidebar-worktrees-wrap`) renders WorktreesSection acceptably; adjust the wrapper classes to match the real sidebar so it looks like the app, not a hand-drawn box. Keep the wrapper minimal — the realism comes from the REAL components, not from re-styling.

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc -b --noEmit
git add src/tutorial/TutorialSandbox.tsx
git commit -m "feat(tutorial): TutorialSandbox mounts real Worktrees components in demo" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 9: Worktrees tour definition + registry

**Files:** Create `src/tutorial/tours/worktrees.ts`; Modify `src/tutorial/registry.ts`

- [ ] **Step 1: Write `src/tutorial/tours/worktrees.ts`**

```typescript
// src/tutorial/tours/worktrees.ts
import type { TourDef } from '../types'

export const worktreesTour: TourDef = {
  id: 'worktrees',
  steps: [
    { id: 'header', anchor: '[data-tour-id="wt-header"]', title: 'Worktrees', body: 'Un worktree es una rama en su propia carpeta: trabajás en paralelo sin pisar tu rama principal.', placement: 'right' },
    { id: 'add', anchor: '[data-tour-id="wt-add"]', title: 'Creá un worktree', body: 'Tocá “+” para crear uno nuevo a partir de una rama.', placement: 'right', advanceOnClick: true },
    { id: 'branch', anchor: '[data-tour-id="wt-branch-input"]', title: 'Nombre de la rama', body: 'Poné el nombre de la rama nueva, ej. feat/billing.', placement: 'bottom' },
    { id: 'presets', anchor: '[data-tour-id="wt-presets"]', title: 'Preset (opcional)', body: 'Elegí un preset para que corra setup automático (instalar deps, levantar dev).', placement: 'bottom' },
    { id: 'env', anchor: '[data-tour-id="wt-env-banner"]', title: 'Archivos .env', body: 'Si hay .env no trackeados, podés copiarlos al worktree nuevo.', placement: 'top' },
    { id: 'create', anchor: '[data-tour-id="wt-create-btn"]', title: 'Crear', body: 'Confirmá: el worktree aparece y corre su setup.', placement: 'top', advanceOnClick: true },
    { id: 'list', anchor: '[data-tour-id="wt-list"]', title: 'Tus worktrees', body: 'Acá aparecen todos, con su estado (amarillo = setup, verde = listo).', placement: 'right' },
    { id: 'diff', anchor: '[data-tour-id="wt-diff-chip"]', title: 'Cambios', body: 'El chip muestra +líneas/−líneas. Tocalo para ver el diff completo.', placement: 'right', advanceOnClick: true },
    { id: 'diff-panel', anchor: '[data-tour-id="diff-panel"]', title: 'Diff', body: 'Revisás los cambios archivo por archivo, sin salir de Nest.', placement: 'left' },
    { id: 'pr', anchor: '[data-tour-id="wt-pr-chip"]', title: 'Pull request', body: 'Si la rama tiene PR, el chip te lleva ahí. Desde el menú podés hacer “Push to GitHub”.', placement: 'right' },
    { id: 'menu', anchor: '[data-tour-id="wt-context-menu"]', title: 'Acciones', body: 'Click derecho en un worktree: push, abrir en IDE, spotlight, o eliminarlo. ¡Eso es Worktrees!', placement: 'right' },
  ],
}
```

- [ ] **Step 2: Register it.** In `src/tutorial/registry.ts`, import `worktreesTour` and add `[worktreesTour.id]: worktreesTour` to the `tours` record. Remove the `activation` import/entry (it's being deleted in Task 12 — if Task 12 runs after, leave activation for now and remove there; to avoid a broken import, do the registry edit for activation removal in Task 12).

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc -b --noEmit
git add src/tutorial/tours/worktrees.ts src/tutorial/registry.ts
git commit -m "feat(tutorial): worktrees tour definition + registry" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 10: Settings "Tutorial" tab launches the sandbox

**Files:** Modify `src/components/SettingsPanel.tsx`; Modify `src/App.tsx`

- [ ] **Step 1: App owns sandbox state + a launcher.** In `src/App.tsx`: add `const [tutorialTour, setTutorialTour] = useState<import('./tutorial/types').TourId | null>(null)`. Render near the other overlays: `{tutorialTour && <TutorialSandbox tourId={tutorialTour} onClose={() => setTutorialTour(null)} />}` and import `TutorialSandbox`. Pass `onOpenTutorial={(id) => setTutorialTour(id)}` to `<SettingsPanel ... />` (add the prop).

- [ ] **Step 2: SettingsPanel tab.** In `src/components/SettingsPanel.tsx`:
  - Add prop to its Props: `onOpenTutorial?: (tourId: import('../tutorial/types').TourId) => void`.
  - Add `'tutorial'` to the `Tab` union (line 11) and to the tab array (line 140).
  - Add a content block:
  ```tsx
  {tab === 'tutorial' && (
    <div className="sp-section">
      <p className="sp-hint">Recorré las secciones de Nest con datos de demostración, sin tocar tus repos.</p>
      <button className="sp-btn" onClick={() => onOpenTutorial?.('worktrees')}>Tutorial: Worktrees</button>
    </div>
  )}
  ```
  (Use the existing button/section classes in this file; match the style of the other tabs.)

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc -b --noEmit
git add src/components/SettingsPanel.tsx src/App.tsx
git commit -m "feat(tutorial): launch sandbox from a Settings 'Tutorial' tab" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 11: First-time auto-launch + remove Sidebar "?"

**Files:** Modify `src/App.tsx`; Modify `src/components/Sidebar.tsx`

- [ ] **Step 1: Auto-launch the first time Worktrees is opened.** In `src/App.tsx`, using the existing `useTourSeen` hook: when the sidebar expands and a repo is linked (Worktrees becomes visible) for the first time, set `setTutorialTour('worktrees')` if `!useTourSeen('worktrees').seen`, and call `markSeen()` when the sandbox closes. Concretely: add `const worktreesSeen = useTourSeen('worktrees')`, and an effect that fires once when the sidebar is expanded with a repoPath:
```tsx
useEffect(() => {
  if (sidebarExpanded && repoPath && !worktreesSeen.seen) {
    setTutorialTour('worktrees')
  }
}, [sidebarExpanded, repoPath, worktreesSeen.seen])
```
and in the sandbox `onClose`: `onClose={() => { if (tutorialTour === 'worktrees') worktreesSeen.markSeen(); setTutorialTour(null) }}`.
(Use the actual variable names in App for sidebar-expanded state and the linked repo path — find them; the explore noted the sidebar is gated on `expanded` and `repoPath`.)

- [ ] **Step 2: Remove the Sidebar "?" button.** In `src/components/Sidebar.tsx` delete the block at ~lines 686–688:
```tsx
{onHelp && (
  <button className="tour-help-btn" title="Tutorial" aria-label="Open tutorial" onClick={() => onHelp('activation')}>?</button>
)}
```
Remove the now-unused `onHelp` prop from Sidebar's Props and from the `<Sidebar onHelp=... />` usage in App.tsx.

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc -b --noEmit
git add src/App.tsx src/components/Sidebar.tsx
git commit -m "feat(tutorial): auto-launch Worktrees tutorial first time; remove sidebar Help button" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 12: Remove Plan 1 activation scaffolding

**Files:** Delete `src/tutorial/DemoActivationStage.tsx`, `src/tutorial/tours/activation.ts`, `src/tutorial/TutorialController.tsx`; Modify `src/tutorial/registry.ts`, `src/App.tsx`, and delete `src/__tests__/components/activation-tour.test.tsx`.

- [ ] **Step 1: Remove the old controller mount.** In `src/App.tsx`, remove `import { TutorialController, openTour } from './tutorial/TutorialController'` and the `<TutorialController />` element and any `openTour` usage (the Sidebar `onHelp` was already removed in Task 11).

- [ ] **Step 2: Remove activation from the registry.** In `src/tutorial/registry.ts`, remove the `activation` import and its entry (leaving `worktrees`).

- [ ] **Step 3: Delete files.**
```bash
git rm src/tutorial/DemoActivationStage.tsx src/tutorial/tours/activation.ts src/tutorial/TutorialController.tsx src/__tests__/components/activation-tour.test.tsx
```

- [ ] **Step 4: `TourId` cleanup.** In `src/tutorial/types.ts`, `TourId` can keep `'activation'` (harmless) — do NOT remove it (other tours will use the union later). No change needed.

- [ ] **Step 5: Run full suite + typecheck.**
```bash
npm run test
npx tsc -b --noEmit
```
Expected: green. Fix any broken import left by the deletions (e.g. `NewPaneDialog` still imports `bridge` from Plan 1 — that's fine, leave it).

- [ ] **Step 6: Commit**
```bash
git add -A src/tutorial src/App.tsx
git commit -m "chore(tutorial): remove Plan 1 activation stage/controller (replaced by sandbox)" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
> Use explicit paths instead of `-A` if other unrelated changes are unstaged. Stage only the tutorial files and App.tsx.

---

## Phase 4 — Integration test

### Task 13: Worktrees tutorial end-to-end + no-real-API guard

**Files:** Create `src/__tests__/components/worktrees-tutorial.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// src/__tests__/components/worktrees-tutorial.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TutorialSandbox } from '../../tutorial/TutorialSandbox'

describe('worktrees tutorial (demo sandbox)', () => {
  beforeEach(() => {
    // Sentinels: the REAL window.* must never be called (components use bridge).
    ;(window as unknown as { worktree: unknown }).worktree = { list: vi.fn(() => { throw new Error('real worktree called') }) }
    ;(window as unknown as { diff: unknown }).diff = { get: vi.fn(() => { throw new Error('real diff called') }) }
  })

  it('mounts the real WorktreesSection with demo data and shows step 1', async () => {
    render(<TutorialSandbox tourId="worktrees" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Worktrees')).toBeInTheDocument())
    // First coachmark step body present
    expect(screen.getByText(/Un worktree es una rama/)).toBeInTheDocument()
  })

  it('walks the whole tour via Next and finishes', async () => {
    const onClose = vi.fn()
    render(<TutorialSandbox tourId="worktrees" onClose={onClose} />)
    await waitFor(() => expect(screen.getByText(/Un worktree es una rama/)).toBeInTheDocument())
    // 11 steps: click Next 10 times, then "Listo"
    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByRole('button', { name: /siguiente/i }))
    }
    fireEvent.click(screen.getByRole('button', { name: /listo/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run → PASS**

Run: `npm run test -- src/__tests__/components/worktrees-tutorial.test.tsx`
Expected: PASS (2 tests). If a sentinel throws ("real worktree called"/"real diff called"), a component still uses `window.*` directly — fix the migration (Phase 2), do not weaken the test.

> NOTE: some steps anchor to elements that only exist after an action (e.g. `wt-modal`, `diff-panel`). Walking via "Next" leaves those anchors absent; the tooltip just centers — that's expected and fine for this test (mirrors the activation-tour test pattern).

- [ ] **Step 3: Full suite + typecheck + commit**

```bash
npm run test
npx tsc -b --noEmit
git add src/__tests__/components/worktrees-tutorial.test.tsx
git commit -m "test(tutorial): worktrees sandbox end-to-end + no-real-API guard" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Manual verification (Electron).** `npm run dev`, link a repo / expand sidebar → the Worktrees tutorial auto-launches (first time); also openable from Settings → Tutorial. Confirm: it looks like the real Worktrees UI, the flow works (create/diff/remove on demo data), the DevTools console has no `bridge`/harness errors, and **no real worktree is created/removed**.

---

## Self-Review (plan author)

**Spec coverage:** §3.1 isolation → Tasks 1,4–7 (bridge migration + selective harness, supabase off). §3.2 sandbox → Task 8. §3.3 selective harness → Task 1. §3.4 bridge migration → Tasks 4–7. §3.5 coachmarks → reused (Task 9 anchors). §5 flow → Task 9 (11 steps). §6 fixtures → Task 2. §7 simulated actions → Task 3 (create/remove/diff/push). §8 entry (Settings + auto 1st-time, remove "?") → Tasks 10–11. §10 reuse/discard → Task 12. §14 testing → Tasks 1,3,13. ✅

**Placeholder scan:** The two NOTE blocks (match mock return shapes to what components read; match sidebar CSS classes) require reading a file first and are explicit, not vague — acceptable. No TBD/TODO in code steps. ✅

**Type consistency:** `DemoState.worktree: WorktreeDemoState` (Task 2) used by `makeWorktreeMocks` (Task 3) and `TutorialSandbox` (Task 8, `stateRef.current.worktree.rootRepoPath`). `createDemoHarness(state, opts)` (Task 1) used in Task 8. `getTour`/`TourDef`/`TourId` consistent. `data-tour-id` anchors in Tasks 4–6 match the tour selectors in Task 9 (`wt-header`, `wt-add`, `wt-branch-input`, `wt-presets`, `wt-env-banner`, `wt-create-btn`, `wt-list`, `wt-diff-chip`, `wt-pr-chip`, `wt-context-menu`, `diff-panel`). ✅

**Ordering note:** Task 9 registers `worktrees` but leaves `activation` import intact until Task 12 deletes it (avoids a broken import mid-plan). ✅
