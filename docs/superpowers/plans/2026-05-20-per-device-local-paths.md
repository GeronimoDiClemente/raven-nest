# Per-device local repo paths — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move local repo path storage from Supabase (per-account) to a local Electron JSON store (per-device), and fix the Teams `handleOpenTerminal` crash that hides the same root cause.

**Architecture:** New `electron/local-paths-store.ts` (mirrors `electron/snippet-store.ts`, lives under `ravenHome()/.raven-nest/local-paths.json`). IPC handlers in `main.ts`, exposed via `window.localPaths` in preload. React hooks `useUserRepos`/`useTeamRepos` read paths from this store; a new one-shot hook `useLocalPathsMigration` imports legacy `local_path` rows from Supabase on first boot. `TeamsWorkspace.handleOpenTerminal` gets a try/catch around `getRemoteUrl` so the dialog Clone/Link path is always reached.

**Tech Stack:** Electron + Vite + React + TypeScript. Vitest for unit tests. Supabase JS client (renderer-only). `node:fs` for the JSON store.

**Spec:** `docs/superpowers/specs/2026-05-20-per-device-local-paths-design.md`

---

## Task 1: Create `local-paths-store.ts` with tests (TDD)

**Files:**
- Create: `electron/local-paths-store.ts`
- Create: `electron/__tests__/local-paths-store.test.ts`
- Reference (pattern): `electron/snippet-store.ts`, `electron/__tests__/preset-store.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `electron/__tests__/local-paths-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'

describe('LocalPathsStore', () => {
  let home: string
  let storeModule: typeof import('../local-paths-store')

  beforeEach(async () => {
    home = makeTmpDir('raven-local-paths-')
    process.env.RAVEN_HOME = home
    vi.resetModules()
    storeModule = await import('../local-paths-store')
  })

  afterEach(() => {
    delete process.env.RAVEN_HOME
    cleanupTmp(home)
  })

  it('getLocalPath returns null for unknown repo', () => {
    const store = new storeModule.LocalPathsStore()
    expect(store.getLocalPath('does-not-exist')).toBeNull()
  })

  it('setLocalPath + getLocalPath round-trip', () => {
    const store = new storeModule.LocalPathsStore()
    store.setLocalPath('repo-1', 'C:/dev/repo-1')
    expect(store.getLocalPath('repo-1')).toBe('C:/dev/repo-1')
  })

  it('deleteLocalPath removes the entry', () => {
    const store = new storeModule.LocalPathsStore()
    store.setLocalPath('repo-1', '/x')
    store.deleteLocalPath('repo-1')
    expect(store.getLocalPath('repo-1')).toBeNull()
  })

  it('getAllLocalPaths returns the full map', () => {
    const store = new storeModule.LocalPathsStore()
    store.setLocalPath('a', '/a')
    store.setLocalPath('b', '/b')
    expect(store.getAllLocalPaths()).toEqual({ a: '/a', b: '/b' })
  })

  it('persists across instances (re-instantiation)', () => {
    new storeModule.LocalPathsStore().setLocalPath('persist', '/p')
    expect(new storeModule.LocalPathsStore().getLocalPath('persist')).toBe('/p')
  })

  it('getMigrationFlag returns null when unset', () => {
    const store = new storeModule.LocalPathsStore()
    expect(store.getMigrationFlag('paths-v1:user-x')).toBeNull()
  })

  it('setMigrationFlag + getMigrationFlag round-trip', () => {
    const store = new storeModule.LocalPathsStore()
    store.setMigrationFlag('paths-v1:user-x', 'done')
    expect(store.getMigrationFlag('paths-v1:user-x')).toBe('done')
  })

  it('flags survive across instances', () => {
    new storeModule.LocalPathsStore().setMigrationFlag('paths-v1:u', 'done')
    expect(new storeModule.LocalPathsStore().getMigrationFlag('paths-v1:u')).toBe('done')
  })

  it('handles corrupted JSON by renaming and starting fresh', () => {
    const dir = join(home, '.raven-nest')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'local-paths.json'), '{not json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = new storeModule.LocalPathsStore()
    expect(store.getAllLocalPaths()).toEqual({})
    // a `.corrupt.<ts>.bak` sibling exists
    const siblings = readdirSync(dir)
    expect(siblings.some((f) => f.startsWith('local-paths.') && f.endsWith('.corrupt.bak'))).toBe(true)
    warn.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to confirm failure (module does not exist)**

Run: `npx vitest run electron/__tests__/local-paths-store.test.ts`
Expected: FAIL with `Cannot find module '../local-paths-store'`.

- [ ] **Step 3: Implement `electron/local-paths-store.ts`**

Create `electron/local-paths-store.ts`:

```ts
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs'
import { ravenHome } from './raven-home'

interface PersistedState {
  paths: Record<string, string>
  migrations: Record<string, string>
}

function emptyState(): PersistedState {
  return { paths: {}, migrations: {} }
}

function fileFor(): { dir: string; file: string } {
  const dir = join(ravenHome(), '.raven-nest')
  return { dir, file: join(dir, 'local-paths.json') }
}

function load(): PersistedState {
  const { dir, file } = fileFor()
  if (!existsSync(file)) return emptyState()
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (err) {
    console.warn('[local-paths-store] read failed, starting fresh:', (err as Error).message)
    return emptyState()
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      paths: (parsed.paths && typeof parsed.paths === 'object') ? parsed.paths as Record<string, string> : {},
      migrations: (parsed.migrations && typeof parsed.migrations === 'object') ? parsed.migrations as Record<string, string> : {},
    }
  } catch {
    // Quarantine the corrupted file so future boots are clean and so the
    // user can recover the previous data if needed. Then proceed empty.
    try {
      const bak = join(dir, `local-paths.${Date.now()}.corrupt.bak`)
      renameSync(file, bak)
      console.warn(`[local-paths-store] corrupted JSON, moved to ${bak}`)
    } catch (err) {
      console.warn('[local-paths-store] failed to quarantine corrupted file:', (err as Error).message)
    }
    return emptyState()
  }
}

function persist(state: PersistedState): void {
  const { dir, file } = fileFor()
  mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(state))
  renameSync(tmp, file)
}

export class LocalPathsStore {
  getLocalPath(repoId: string): string | null {
    return load().paths[repoId] ?? null
  }

  setLocalPath(repoId: string, path: string): void {
    const state = load()
    state.paths[repoId] = path
    persist(state)
  }

  deleteLocalPath(repoId: string): void {
    const state = load()
    if (!(repoId in state.paths)) return
    delete state.paths[repoId]
    persist(state)
  }

  getAllLocalPaths(): Record<string, string> {
    return { ...load().paths }
  }

  getMigrationFlag(key: string): string | null {
    return load().migrations[key] ?? null
  }

  setMigrationFlag(key: string, value: string): void {
    const state = load()
    state.migrations[key] = value
    persist(state)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/__tests__/local-paths-store.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/local-paths-store.ts electron/__tests__/local-paths-store.test.ts
git commit -m "feat(electron): add LocalPathsStore for per-device repo paths

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire IPC handlers in `main.ts`

**Files:**
- Modify: `electron/main.ts` (add import, instantiate store, register handlers; sections around lines 107-140 and 769-772)

- [ ] **Step 1: Add the import**

Open `electron/main.ts`. Near the other store imports (around line 108 where `SnippetStore` is imported), add:

```ts
import { LocalPathsStore } from './local-paths-store'
```

- [ ] **Step 2: Instantiate the singleton**

Below the `snippetStore` instantiation (around line 140 — `const snippetStore = new SnippetStore()`), add:

```ts
const localPathsStore = new LocalPathsStore()
```

- [ ] **Step 3: Register IPC handlers**

After the snippet IPC handlers (after line 772), add a new block:

```ts
// LocalPaths IPC handlers (per-device repo paths)
ipcMain.handle('localPaths:get', (_event, repoId: string) => localPathsStore.getLocalPath(repoId))
ipcMain.handle('localPaths:set', (_event, repoId: string, path: string) => {
  localPathsStore.setLocalPath(repoId, path)
})
ipcMain.handle('localPaths:delete', (_event, repoId: string) => {
  localPathsStore.deleteLocalPath(repoId)
})
ipcMain.handle('localPaths:getAll', () => localPathsStore.getAllLocalPaths())
ipcMain.handle('localPaths:getMigrationFlag', (_event, key: string) => localPathsStore.getMigrationFlag(key))
ipcMain.handle('localPaths:setMigrationFlag', (_event, key: string, value: string) => {
  localPathsStore.setMigrationFlag(key, value)
})
```

- [ ] **Step 4: Verify it still typechecks/builds**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors. (If it fails for unrelated reasons, fix only the new code.)

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat(electron): register IPC handlers for LocalPathsStore

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Expose `window.localPaths` in preload + add types

**Files:**
- Modify: `electron/preload.ts` (add a new `contextBridge.exposeInMainWorld` block)
- Modify: `src/types.ts` (add typing inside the existing `declare global { interface Window { … } }` block, near `pathUtils` around line 427)

- [ ] **Step 1: Expose `window.localPaths` in `electron/preload.ts`**

Open `electron/preload.ts`. After the existing `contextBridge.exposeInMainWorld('snippets', { … })` block (around line 16-20), add a new sibling block:

```ts
contextBridge.exposeInMainWorld('localPaths', {
  get: (repoId: string) => ipcRenderer.invoke('localPaths:get', repoId),
  set: (repoId: string, path: string) => ipcRenderer.invoke('localPaths:set', repoId, path),
  delete: (repoId: string) => ipcRenderer.invoke('localPaths:delete', repoId),
  getAll: () => ipcRenderer.invoke('localPaths:getAll'),
  getMigrationFlag: (key: string) => ipcRenderer.invoke('localPaths:getMigrationFlag', key),
  setMigrationFlag: (key: string, value: string) => ipcRenderer.invoke('localPaths:setMigrationFlag', key, value),
})
```

- [ ] **Step 2: Add the type declaration in `src/types.ts`**

Open `src/types.ts`. Find the existing `pathUtils` declaration (around line 427) inside `declare global { interface Window { … } }`. Add a new sibling property:

```ts
    localPaths: {
      get: (repoId: string) => Promise<string | null>
      set: (repoId: string, path: string) => Promise<void>
      delete: (repoId: string) => Promise<void>
      getAll: () => Promise<Record<string, string>>
      getMigrationFlag: (key: string) => Promise<string | null>
      setMigrationFlag: (key: string, value: string) => Promise<void>
    }
```

- [ ] **Step 3: Smoke check the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add electron/preload.ts src/types.ts
git commit -m "feat(preload): expose window.localPaths for the LocalPathsStore

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Implement `useLocalPathsMigration` hook with tests

**Files:**
- Create: `src/hooks/useLocalPathsMigration.ts`
- Create: `src/__tests__/components/useLocalPathsMigration.test.tsx`

The migration reads `user_repos.local_path` and `team_repo_local_paths.local_path` once per `(user_id)` and copies any path that exists on disk to the local store.

**Test environment note:** `vitest.config.ts` puts only `src/__tests__/components/**/*.test.tsx` in the jsdom project. The hook uses `useEffect` so it needs `renderHook` from `@testing-library/react`, which requires DOM. That's why the file lives under `components/` with the `.tsx` extension even though it tests a hook.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/components/useLocalPathsMigration.test.tsx`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLocalPathsMigration } from '../../hooks/useLocalPathsMigration'

const supabaseMock = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  from: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

const localPathsMock = {
  set: vi.fn(),
  getMigrationFlag: vi.fn(),
  setMigrationFlag: vi.fn(),
}
const pathUtilsMock = { exists: vi.fn() }

function buildFromChain(rows: unknown[], error: unknown = null) {
  // Both queries use slightly different chains. Return an object that
  // supports the chained methods used in the hook and resolves with the
  // same payload.
  const promise = Promise.resolve({ data: rows, error })
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    then: (onFulfilled: unknown) => promise.then(onFulfilled as never),
  }
  return chain
}

describe('useLocalPathsMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as unknown as { window: Window }).window.localPaths = localPathsMock as never
    ;(globalThis as unknown as { window: Window }).window.pathUtils = pathUtilsMock as never
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-A' } } })
  })

  it('skips when flag is already done', async () => {
    localPathsMock.getMigrationFlag.mockResolvedValue('done')
    renderHook(() => useLocalPathsMigration())
    await waitFor(() => expect(localPathsMock.getMigrationFlag).toHaveBeenCalled())
    expect(supabaseMock.from).not.toHaveBeenCalled()
    expect(localPathsMock.set).not.toHaveBeenCalled()
  })

  it('imports rows whose path exists on disk', async () => {
    localPathsMock.getMigrationFlag.mockResolvedValue(null)
    supabaseMock.from
      .mockReturnValueOnce(buildFromChain([{ id: 'repo-1', local_path: '/exists' }]))
      .mockReturnValueOnce(buildFromChain([]))
    pathUtilsMock.exists.mockResolvedValue(true)
    renderHook(() => useLocalPathsMigration())
    await waitFor(() => expect(localPathsMock.setMigrationFlag).toHaveBeenCalled())
    expect(localPathsMock.set).toHaveBeenCalledWith('repo-1', '/exists')
  })

  it('skips rows whose path does not exist', async () => {
    localPathsMock.getMigrationFlag.mockResolvedValue(null)
    supabaseMock.from
      .mockReturnValueOnce(buildFromChain([{ id: 'repo-2', local_path: '/missing' }]))
      .mockReturnValueOnce(buildFromChain([]))
    pathUtilsMock.exists.mockResolvedValue(false)
    renderHook(() => useLocalPathsMigration())
    await waitFor(() => expect(localPathsMock.setMigrationFlag).toHaveBeenCalled())
    expect(localPathsMock.set).not.toHaveBeenCalled()
  })

  it('imports team_repo_local_paths filtered by current user', async () => {
    localPathsMock.getMigrationFlag.mockResolvedValue(null)
    supabaseMock.from
      .mockReturnValueOnce(buildFromChain([]))
      .mockReturnValueOnce(buildFromChain([{ team_repo_id: 'tr-1', local_path: '/team' }]))
    pathUtilsMock.exists.mockResolvedValue(true)
    renderHook(() => useLocalPathsMigration())
    await waitFor(() => expect(localPathsMock.set).toHaveBeenCalledWith('tr-1', '/team'))
  })

  it('does NOT set the flag if a Supabase query throws', async () => {
    localPathsMock.getMigrationFlag.mockResolvedValue(null)
    supabaseMock.from
      .mockReturnValueOnce(buildFromChain([], { message: 'rls denied' }))
      .mockReturnValueOnce(buildFromChain([]))
    renderHook(() => useLocalPathsMigration())
    // Give the effect a moment to run any branches.
    await new Promise((r) => setTimeout(r, 20))
    expect(localPathsMock.setMigrationFlag).not.toHaveBeenCalled()
  })

  it('sets the flag keyed by user id on success', async () => {
    localPathsMock.getMigrationFlag.mockResolvedValue(null)
    supabaseMock.from
      .mockReturnValueOnce(buildFromChain([]))
      .mockReturnValueOnce(buildFromChain([]))
    renderHook(() => useLocalPathsMigration())
    await waitFor(() =>
      expect(localPathsMock.setMigrationFlag).toHaveBeenCalledWith('paths-v1:user-A', 'done')
    )
  })
})
```

- [ ] **Step 2: Run the test to confirm failure**

Run: `npx vitest run src/__tests__/components/useLocalPathsMigration.test.tsx`
Expected: FAIL with `Cannot find module '../../hooks/useLocalPathsMigration'`.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useLocalPathsMigration.ts`:

```ts
import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

const FLAG_PREFIX = 'paths-v1'

export function useLocalPathsMigration(): void {
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return

      const flagKey = `${FLAG_PREFIX}:${user.id}`
      const done = await window.localPaths.getMigrationFlag(flagKey)
      if (done === 'done' || cancelled) return

      let supabaseFailed = false

      const userReposRes = await supabase
        .from('user_repos')
        .select('id, local_path')
        .not('local_path', 'is', null)
      if (userReposRes.error) {
        console.warn('[useLocalPathsMigration] select user_repos failed; will retry next boot', userReposRes.error)
        supabaseFailed = true
      }
      const userRepoRows = (userReposRes.data ?? []) as Array<{ id: string; local_path: string | null }>

      const teamPathsRes = await supabase
        .from('team_repo_local_paths')
        .select('team_repo_id, local_path')
        .eq('user_id', user.id)
      if (teamPathsRes.error) {
        console.warn('[useLocalPathsMigration] select team_repo_local_paths failed; will retry next boot', teamPathsRes.error)
        supabaseFailed = true
      }
      const teamPathRows = (teamPathsRes.data ?? []) as Array<{ team_repo_id: string; local_path: string | null }>

      for (const row of userRepoRows) {
        if (cancelled) return
        if (!row.local_path) continue
        const exists = await window.pathUtils.exists(row.local_path).catch(() => false)
        if (exists) await window.localPaths.set(row.id, row.local_path)
      }
      for (const row of teamPathRows) {
        if (cancelled) return
        if (!row.local_path) continue
        const exists = await window.pathUtils.exists(row.local_path).catch(() => false)
        if (exists) await window.localPaths.set(row.team_repo_id, row.local_path)
      }

      if (!supabaseFailed && !cancelled) {
        await window.localPaths.setMigrationFlag(flagKey, 'done')
      }
    })().catch((err) => {
      console.warn('[useLocalPathsMigration] unexpected error:', err)
    })

    return () => { cancelled = true }
  }, [])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/components/useLocalPathsMigration.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLocalPathsMigration.ts src/__tests__/components/useLocalPathsMigration.test.tsx
git commit -m "feat(hooks): one-shot migration of legacy local_path from Supabase

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Refactor `useUserRepos` to read paths from the local store

**Files:**
- Modify: `src/hooks/useUserRepos.ts`

Goal of this task: `useUserRepos` no longer reads or writes `local_path` from/to Supabase. The returned `repos[i].local_path` comes from `window.localPaths.getAll()`. The hook's external API (the property name `local_path` on each repo) stays unchanged so callers do not change.

- [ ] **Step 1: Replace the file contents**

Open `src/hooks/useUserRepos.ts` and replace the whole file with:

```ts
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface UserRepo {
  id: string
  user_id: string
  repo_full_name: string
  repo_url: string
  added_at: string
  local_path: string | null
  provider: 'github' | 'gitlab'
}

interface UserRepoRow {
  id: string
  user_id: string
  repo_full_name: string
  repo_url: string
  added_at: string
  provider?: 'github' | 'gitlab' | null
}

export function useUserRepos() {
  const [repos, setRepos] = useState<UserRepo[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [reposRes, localPaths] = await Promise.all([
      supabase
        .from('user_repos')
        .select('id, user_id, repo_full_name, repo_url, added_at, provider')
        .order('added_at', { ascending: false }),
      window.localPaths.getAll(),
    ])
    if (reposRes.error) {
      console.warn('[useUserRepos.refresh] select user_repos failed; keeping previous state', reposRes.error)
      setLoading(false)
      return
    }
    const rows = (reposRes.data ?? []) as UserRepoRow[]
    setRepos(rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      repo_full_name: r.repo_full_name,
      repo_url: r.repo_url,
      added_at: r.added_at,
      provider: r.provider ?? 'github',
      local_path: localPaths[r.id] ?? null,
    })))
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const addRepo = useCallback(async (
    repoFullName: string,
    provider: 'github' | 'gitlab',
    localPath?: string | null,
  ): Promise<boolean> => {
    const repoUrl = provider === 'gitlab'
      ? `https://gitlab.com/${repoFullName}`
      : `https://github.com/${repoFullName}`
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const insertRes = await supabase
      .from('user_repos')
      .insert({ user_id: user.id, repo_full_name: repoFullName, repo_url: repoUrl, provider })
      .select('id')
      .single()
    if (insertRes.error || !insertRes.data) {
      console.warn('[useUserRepos.addRepo] insert failed', { repoFullName, provider }, insertRes.error)
      return false
    }
    if (localPath) {
      await window.localPaths.set(insertRes.data.id, localPath)
    }
    await refresh()
    return true
  }, [refresh])

  const updateLocalPath = useCallback(async (repoId: string, localPath: string | null) => {
    if (localPath) await window.localPaths.set(repoId, localPath)
    else await window.localPaths.delete(repoId)
    await refresh()
  }, [refresh])

  const removeRepo = useCallback(async (repoId: string) => {
    const { error } = await supabase.from('user_repos').delete().eq('id', repoId)
    if (error) console.warn('[useUserRepos.removeRepo] delete failed', { repoId }, error)
    await window.localPaths.delete(repoId)
    await refresh()
  }, [refresh])

  return { repos, loading, refresh, addRepo, updateLocalPath, removeRepo }
}
```

Key changes vs. previous version:
- Supabase `select` no longer fetches `local_path`.
- `insert` (in `addRepo`) no longer writes `local_path`. The local path is stored via `window.localPaths.set` when provided.
- `updateLocalPath` writes/deletes only against the local store.
- `removeRepo` also cleans up the local path for that repo id.

- [ ] **Step 2: Verify build + existing tests pass**

Run: `npm run build && npx vitest run`
Expected: build succeeds, no test regressions. (Hook is consumed by `MyReposPanel`; there are no existing unit tests for `useUserRepos`, so this is mostly a typecheck gate.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useUserRepos.ts
git commit -m "refactor(useUserRepos): read paths from LocalPathsStore, not Supabase

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Refactor `useTeamRepos` to read paths from the local store

**Files:**
- Modify: `src/hooks/useTeamRepos.ts`

Same shape as Task 5. `userLocalPaths` (the existing return) is now built from `window.localPaths.getAll()` filtered by `repo.id`. The deprecated `team_repos.local_path` and `team_repo_local_paths` writes are removed.

- [ ] **Step 1: Replace the file contents**

Open `src/hooks/useTeamRepos.ts` and replace the whole file with:

```ts
import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { PROVIDER_HOST } from '../components/ProviderAvatar'

export interface TeamRepo {
  id: string
  team_id: string
  repo_full_name: string
  repo_url: string
  added_by: string
  added_at: string
  local_path: string | null // legacy column; not used by v1.2+. Kept on the type for compatibility.
  provider: 'github' | 'gitlab'
}

export interface TeamRepoPermission {
  id: string
  team_repo_id: string
  user_id: string
  permission: 'read' | 'write' | 'admin'
}

interface TeamRepoRow {
  id: string
  team_id: string
  repo_full_name: string
  repo_url: string
  added_by: string
  added_at: string
  provider?: 'github' | 'gitlab' | null
}

export function useTeamRepos(teamId: string | null) {
  const [repos, setRepos] = useState<TeamRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [userLocalPaths, setUserLocalPaths] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    if (!teamId) { setRepos([]); setUserLocalPaths({}); return }
    setLoading(true)

    const [reposRes, localPaths] = await Promise.all([
      supabase
        .from('team_repos')
        .select('id, team_id, repo_full_name, repo_url, added_by, added_at, provider')
        .eq('team_id', teamId)
        .order('added_at', { ascending: false }),
      window.localPaths.getAll(),
    ])
    if (reposRes.error) {
      console.warn('[useTeamRepos.refresh] select team_repos failed; keeping previous state', { teamId }, reposRes.error)
      setLoading(false)
      return
    }
    const rows = (reposRes.data ?? []) as TeamRepoRow[]
    setRepos(rows.map((r) => ({
      id: r.id,
      team_id: r.team_id,
      repo_full_name: r.repo_full_name,
      repo_url: r.repo_url,
      added_by: r.added_by,
      added_at: r.added_at,
      provider: r.provider ?? 'github',
      local_path: null, // legacy field; v1.2+ uses LocalPathsStore exclusively
    })))
    const filtered: Record<string, string> = {}
    for (const row of rows) if (localPaths[row.id]) filtered[row.id] = localPaths[row.id]
    setUserLocalPaths(filtered)
    setLoading(false)
  }, [teamId])

  const addRepo = useCallback(async (
    repoFullName: string,
    provider: 'github' | 'gitlab' = 'github',
    localPath?: string | null,
  ): Promise<boolean> => {
    if (!teamId) return false
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const repoUrl = `${PROVIDER_HOST[provider]}/${repoFullName}`
    const insertRes = await supabase
      .from('team_repos')
      .insert({ team_id: teamId, repo_full_name: repoFullName, repo_url: repoUrl, added_by: user.id, provider })
      .select('id')
      .single()
    if (insertRes.error || !insertRes.data) {
      if (insertRes.error) console.warn('[useTeamRepos.addRepo] insert team_repos failed', { teamId, repoFullName, provider }, insertRes.error)
      return false
    }
    if (localPath) await window.localPaths.set(insertRes.data.id, localPath)
    await refresh()
    return true
  }, [teamId, refresh])

  const updateUserLocalPath = useCallback(async (repoId: string, localPath: string | null) => {
    if (localPath) {
      await window.localPaths.set(repoId, localPath)
      setUserLocalPaths((prev) => ({ ...prev, [repoId]: localPath }))
    } else {
      await window.localPaths.delete(repoId)
      setUserLocalPaths((prev) => { const next = { ...prev }; delete next[repoId]; return next })
    }
  }, [])

  const removeRepo = useCallback(async (repoId: string) => {
    const { error } = await supabase.from('team_repos').delete().eq('id', repoId)
    if (error) console.warn('[useTeamRepos.removeRepo] delete failed', { repoId }, error)
    await window.localPaths.delete(repoId)
    await refresh()
  }, [refresh])

  const setPermission = useCallback(async (
    repoId: string, userId: string, permission: 'read' | 'write' | 'admin',
  ) => {
    const { error } = await supabase
      .from('team_repo_permissions')
      .upsert({ team_repo_id: repoId, user_id: userId, permission }, { onConflict: 'team_repo_id,user_id' })
    if (error) console.warn('[useTeamRepos.setPermission] upsert failed', { repoId, userId, permission }, error)
  }, [])

  return { repos, loading, userLocalPaths, refresh, addRepo, updateUserLocalPath, removeRepo, setPermission }
}
```

Key changes vs. previous version:
- Removed all reads/writes against `team_repo_local_paths`.
- Removed all reads/writes of `team_repos.local_path`.
- `userLocalPaths` is built from `window.localPaths.getAll()` filtered by the team's repo ids.
- `local_path` field on `TeamRepo` is preserved on the type for compatibility but is always `null` from v1.2+.

- [ ] **Step 2: Verify build + tests**

Run: `npm run build && npx vitest run`
Expected: build succeeds, no test regressions.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useTeamRepos.ts
git commit -m "refactor(useTeamRepos): per-device paths via LocalPathsStore

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Fix the Teams `handleOpenTerminal` crash with a regression test

**Files:**
- Create: `src/__tests__/components/TeamsWorkspace-open-terminal.test.tsx`
- Modify: `src/components/TeamsWorkspace.tsx` (only the `handleOpenTerminal` body, currently lines 224–258)

Two things in one task because they target the same root cause:
1. Wrap `window.git.getRemoteUrl(userPath)` in try/catch so a throw never breaks the handler. Identical pattern to `MyReposPanel.tsx:145-164`.
2. With Task 6 in place, `repo.local_path` is always `null` for team repos in v1.2+, so the legacy fallback branch becomes dead code. Remove it.

- [ ] **Step 1: Write the failing regression test**

Create `src/__tests__/components/TeamsWorkspace-open-terminal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TeamsWorkspace from '../../components/TeamsWorkspace'

// Light mocks for hooks TeamsWorkspace depends on. We only test the open-terminal flow.
const teamRepo = {
  id: 'tr-1',
  team_id: 't-1',
  repo_full_name: 'org/repo',
  repo_url: 'https://github.com/org/repo',
  added_by: 'u-1',
  added_at: '2026-05-20T00:00:00Z',
  provider: 'github' as const,
  local_path: null,
}

vi.mock('../../hooks/useTeam', () => ({
  useTeam: () => ({
    teams: [{ id: 't-1', name: 'T', owner_id: 'u-1', created_at: '' }],
    activeTeam: { id: 't-1', name: 'T', owner_id: 'u-1', created_at: '' },
    members: [{ id: 'm-1', team_id: 't-1', user_id: 'u-1', email: 'a@b.c', role: 'leader', status: 'active', invited_by: 'u-1', invited_at: '', accepted_at: null }],
    pendingInvites: [], myPendingRequests: [], loading: false, userId: 'u-1',
    switchTeam: vi.fn(), createTeam: vi.fn(), inviteMember: vi.fn(), removeMember: vi.fn(),
    promoteMember: vi.fn(), demoteMember: vi.fn(),
    acceptInvite: vi.fn(), rejectInvite: vi.fn(),
    requestJoin: vi.fn(), cancelRequest: vi.fn(), approveRequest: vi.fn(), declineRequest: vi.fn(),
    leaveTeam: vi.fn(), deleteTeam: vi.fn(), refresh: vi.fn(),
  }),
}))

vi.mock('../../hooks/useTeamRepos', () => ({
  useTeamRepos: () => ({
    repos: [teamRepo],
    loading: false,
    userLocalPaths: { 'tr-1': 'C:/dev/repo' },
    refresh: vi.fn(),
    addRepo: vi.fn(),
    updateUserLocalPath: vi.fn(),
    removeRepo: vi.fn(),
    setPermission: vi.fn(),
  }),
}))

vi.mock('../../hooks/useTeamPresence', () => ({ useTeamPresence: () => ({ presence: {} }) }))
vi.mock('../../hooks/useSharedSnippets', () => ({ useSharedSnippets: () => ({ items: [], loading: false, userId: 'u-1', refresh: vi.fn(), remove: vi.fn() }) }))
vi.mock('../../hooks/useSharedWorkspaces', () => ({ useSharedWorkspaces: () => ({ items: [], loading: false, userId: 'u-1', refresh: vi.fn(), remove: vi.fn() }) }))
vi.mock('../../hooks/useSharedMcpConfigs', () => ({ useSharedMcpConfigs: () => ({ items: [], loading: false, userId: 'u-1', refresh: vi.fn(), remove: vi.fn() }) }))
vi.mock('../../hooks/useGitHub', () => ({ useGitHub: () => ({ githubLogin: 'me', githubToken: 't', isConnected: true, connectGitHub: vi.fn() }) }))
vi.mock('../../hooks/useGitlab', () => ({ useGitlab: () => ({ gitlabLogin: null, gitlabToken: null, isConnected: false, connectGitlab: vi.fn() }) }))
vi.mock('../../hooks/useGitHubNotifications', () => ({ useGitHubNotifications: () => ({ notifications: [], unreadCount: 0, markAsRead: vi.fn() }) }))
vi.mock('../../hooks/useTeamChat', () => ({ useTeamChat: () => ({}) }))
vi.mock('../../hooks/useTeamsKeyboard', () => ({ useTeamsKeyboard: () => {} }))

describe('TeamsWorkspace.handleOpenTerminal regression', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: Window }).window.pathUtils = { exists: vi.fn().mockResolvedValue(true) } as never
    ;(globalThis as unknown as { window: Window }).window.git = {
      getRemoteUrl: vi.fn().mockRejectedValue(new Error('git missing')),
    } as never
  })

  it('opens the Clone/Link dialog when getRemoteUrl throws (does not crash)', async () => {
    const onOpenRepoTerminal = vi.fn()
    render(
      <TeamsWorkspace
        onClose={vi.fn()}
        onOpenRepoTerminal={onOpenRepoTerminal}
      />,
    )
    // Navigate to the Repos section, click the Terminal button.
    fireEvent.click(await screen.findByRole('button', { name: /repos/i }))
    const terminalBtn = await screen.findByRole('button', { name: /terminal/i })
    fireEvent.click(terminalBtn)
    // The cloneTarget dialog header is the repo's full name.
    await waitFor(() => {
      expect(screen.getByText('org/repo')).toBeInTheDocument()
    })
    expect(onOpenRepoTerminal).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails (current code crashes/leaks)**

Run: `npx vitest run src/__tests__/components/TeamsWorkspace-open-terminal.test.tsx`
Expected: FAIL — the unhandled rejection from `getRemoteUrl` either propagates or the dialog never appears (depending on test runner behavior).

- [ ] **Step 3: Patch `handleOpenTerminal`**

Open `src/components/TeamsWorkspace.tsx`. Replace the `handleOpenTerminal` function (currently lines 224–258) with:

```tsx
  const handleOpenTerminal = async (repo: TeamRepo) => {
    if (terminalOpening) return
    setTerminalOpening(true)
    try {
      const userPath = userLocalPaths?.[repo.id]
      if (!userPath) {
        setCloneTarget(repo)
        return
      }
      const exists = await window.pathUtils.exists(userPath).catch(() => false)
      if (!exists) {
        setCloneTarget(repo)
        return
      }
      // Verify the local folder still points at this repo's remote.
      // Mirrors MyReposPanel.tsx:145-164 — getRemoteUrl can throw (git missing,
      // folder not a repo, permissions) and we MUST fall through to the
      // Clone/Link dialog instead of letting the handler die silently.
      try {
        const remoteUrl = await window.git.getRemoteUrl(userPath)
        const norm = (u: string) => u
          .replace(/\.git$/, '')
          .replace(/\/+$/, '')
          .replace(/^https?:\/\/[^@/]+@/, 'https://')
          .toLowerCase()
        if (typeof remoteUrl === 'string' && remoteUrl && norm(remoteUrl) !== norm(repo.repo_url)) {
          setCloneTarget(repo)
          return
        }
      } catch {
        setCloneTarget(repo)
        return
      }
      onOpenRepoTerminal(repo.repo_full_name, userPath)
    } finally {
      setTerminalOpening(false)
    }
  }
```

Notes:
- The legacy `repo.local_path` fallback branch (formerly lines 238–252) is gone — `useTeamRepos` no longer populates that field in v1.2+.
- `getRemoteUrl` is now wrapped in try/catch.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/components/TeamsWorkspace-open-terminal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/__tests__/components/TeamsWorkspace-open-terminal.test.tsx src/components/TeamsWorkspace.tsx
git commit -m "fix(teams): wrap getRemoteUrl in try/catch, drop legacy local_path fallback

Without the try/catch, a thrown error from getRemoteUrl (git missing,
folder not a repo, perms) broke handleOpenTerminal silently and the
Clone/Link dialog was never shown. Pattern now matches MyReposPanel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Mount `useLocalPathsMigration` in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the import**

Open `src/App.tsx`. Near the other hook imports at the top of the file, add:

```ts
import { useLocalPathsMigration } from './hooks/useLocalPathsMigration'
```

- [ ] **Step 2: Mount the hook inside `App`**

Inside the `App` function component body, near the other top-level hook calls (find a spot after auth-related hooks but before render-time logic), add:

```tsx
  useLocalPathsMigration()
```

The hook is a no-op until `supabase.auth.getUser()` resolves to a user, so mount order does not matter as long as it lives inside the component.

- [ ] **Step 3: Verify build + tests**

Run: `npm run build && npx vitest run`
Expected: build succeeds, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): run one-shot local-paths migration on boot

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Manual QA + update release docs

This task is execution-only — no code changes. It enforces the pre-release checklist from the spec.

- [ ] **Step 1: Run the full automated suite**

Run: `npx vitest run`
Expected: all tests pass, including the three new test files from Tasks 1, 4, and 7.

- [ ] **Step 2: Build a local installer per OS available to you**

For at least Windows (and Mac/Linux if available):

Run: `npm run package:win` (or `package:mac` / `package:linux`)
Expected: artifact in `dist/` (Setup.exe / .dmg / .AppImage).

- [ ] **Step 3: Manual QA — golden path on a fresh `RAVEN_HOME`**

Set `RAVEN_HOME` to an empty temp dir and launch the dev app:

```powershell
$env:RAVEN_HOME = (Join-Path $env:TEMP "raven-qa-fresh")
npm run dev
```

Verify:
- My Repos shows all repos with no local path; Clone/Link dialog opens for each.
- Linking a folder persists across restart.
- Teams: same behavior. Open Terminal on a repo without a path opens the Clone/Link dialog.
- Inside `$env:RAVEN_HOME/.raven-nest/local-paths.json`, paths and migrations show the new entries.

- [ ] **Step 4: Manual QA — simulated crash repro**

With a repo linked in Teams, manually rename or delete the local folder. Click "Terminal" in Teams.
Expected: Clone/Link dialog appears. No `ErrorBoundary` triggered. No silent no-op.

- [ ] **Step 5: Manual QA — migration from a real previous install**

On a machine with v1.1.x state (existing `user_repos.local_path` rows in Supabase), launch the dev build of v1.2 unset of `RAVEN_HOME`.
Expected:
- `local-paths.json` is created on first launch.
- Repos visible in My Repos / Teams retain their existing paths if the folders still exist on disk.
- Repos whose Supabase path no longer points to a real folder appear without a path (Clone/Link offered).
- After the first launch, `migrations` in `local-paths.json` includes `paths-v1:<userId>: "done"`.

- [ ] **Step 6: Manual QA — corruption resilience**

While the app is closed, replace `$env:RAVEN_HOME/.raven-nest/local-paths.json` contents with `{not json`. Relaunch.
Expected: app boots normally, a sibling file `local-paths.<ts>.corrupt.bak` is created. UI shows no paths (Clone/Link offered everywhere).

- [ ] **Step 7: Update `CLAUDE.md` user-facing notes**

Open `CLAUDE.md`. Under the existing "Hacer una release" section, add a sub-bullet (or a new short section) noting:

> ### v1.2 — per-device local paths
> A partir de v1.2 los paths locales de los repos se guardan **por máquina** en `~/.raven-nest/local-paths.json`. Al actualizar desde v1.1.x, el primer arranque importa los paths existentes desde Supabase (solo los que existan en disco). Una segunda PC en la misma cuenta partirá sin paths y ofrecerá Clone / Link existing folder por repo.

- [ ] **Step 8: Commit the docs update**

```bash
git add CLAUDE.md
git commit -m "docs(claude): note per-device local paths behavior for v1.2

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 9: Final smoke before release**

If all manual QA passes:
1. Bump `package.json` to `1.2.0`.
2. Follow the release steps in `CLAUDE.md` ("Hacer una release"): `gh release create`, trigger Build workflow, verify artifacts.
3. If anything in steps 3–6 fails, do NOT tag. Fix and re-run from the failing step.

---

## Spec coverage check (self-review)

- Per-device storage in `userData` via JSON store → Task 1 (`LocalPathsStore`), Task 2 (IPC), Task 3 (preload/types).
- Key by `repo_id` → Task 5/6 use `repo.id` consistently in `set`/`get`/`delete`.
- One-shot migration at boot, keyed by user → Task 4 (`useLocalPathsMigration`), Task 8 (mount in App).
- Migration validates `pathUtils.exists` and skips non-existing → Task 4 test case "skips rows whose path does not exist".
- Flag NOT set on Supabase error → Task 4 test "does NOT set the flag if a Supabase query throws".
- Renderer hooks read paths from local store, never write `local_path` to Supabase → Task 5, Task 6.
- v1.1.x compatibility (no destructive Supabase writes) → Tasks 5/6 explicitly drop the writes; no SQL migration in scope.
- Teams crash fix (try/catch around `getRemoteUrl`) → Task 7.
- Corrupted store quarantine → Task 1 test "handles corrupted JSON by renaming and starting fresh", implementation in `local-paths-store.ts`.
- Pre-release QA checklist → Task 9.
