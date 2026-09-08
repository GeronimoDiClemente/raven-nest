# Personal Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `Team` and `My Repos` sidebar doors with one `Personal` door that lists your repos and every team's repos behind a scope selector, and strip the duplicated sections out of `TeamsWorkspace`.

**Architecture:** `MyReposPanel` is renamed to `PersonalWorkspace` and gains a scope selector; a new `useScopedRepos(scope, isTeamLeader)` hook normalises `useUserRepos` and `useTeamRepos` into one `Repo` type so the existing sections work unchanged. `TeamsWorkspace` loses `activity`, `repos`, `issues` and `pendings` and is reached from the selector instead of from the sidebar.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, Supabase JS, Electron preload (`window.localPaths`).

**Spec:** `docs/superpowers/specs/2026-09-08-personal-workspace-design.md`

## Global Constraints

- **All UI text, code and comments in English.** Conversation with the user is in Spanish; the product is not.
- **Baseline is 877 passing tests** on `feat/sidebar-tabs`. Every task ends green. Run the full suite with `npm test` (vitest run).
- **`docs/superpowers` is gitignored.** Any file added under it needs `git add -f`. Source files under `src/` add normally.
- **`npx tsc --noEmit` checks nothing in this repo** (solution-style tsconfig with `files: []`). The real check is `npx tsc -b`, which emits `.js`/`.d.ts` next to sources. After running it: `git add` any NEW source files FIRST, then `git clean -fd`. There are ~13 pre-existing `tsc -b` errors on this branch (pidusage, metrics-collector); do not try to fix them.
- **Do not touch spacing, density or font tokens.** The 2026-09-07 decision stands: VS Code typography, Nest spacing.
- **Plan gating is preserved exactly:** the door uses `planLimits.allowMyRepos`, the scope selector uses `planLimits.allowTeam`. No plan gains or loses access.
- Work in the worktree `C:\Users\gerod\Dev\raven-nest\.claude\worktrees\sidebar-tabs` on branch `feat/sidebar-tabs`. Do not push.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/hooks/useScopedRepos.ts` (create) | Normalise both repo sources into one `Repo[]` plus scope-aware actions |
| `src/hooks/useTeamRepos.ts` (modify) | Add a stale-response guard so a slow fetch for team A cannot overwrite team B |
| `src/components/PersonalWorkspace.tsx` (rename from `MyReposPanel.tsx`) | The single Personal surface: scope selector + activity/repos/issues/standup/pendings |
| `src/components/ScopeSelector.tsx` (create) | The Personal/team switch and the "Open team workspace" button |
| `src/components/TeamsWorkspace.tsx` (modify) | Drop the four duplicated sections |
| `src/components/Sidebar.tsx` (modify) | One `Personal` footer row; three tabs |
| `src/components/SidebarTabBar.tsx` (modify) | `REPO_TABS` drops `personal` |
| `src/components/PersonalPanel.tsx` (delete) | Superseded by the door |
| `src/App.tsx` (modify) | `teamsOpen` + `myReposOpen` collapse into `personalOpen` |

---

### Task 1: `useScopedRepos` and the stale-response guard

**Files:**
- Create: `src/hooks/useScopedRepos.ts`
- Modify: `src/hooks/useTeamRepos.ts` (the `refresh` callback, lines 35-71)
- Test: `src/__tests__/hooks/useScopedRepos.test.tsx`

**Interfaces:**
- Consumes: `useUserRepos()` returning `{ repos, loading, refresh, addRepo, updateLocalPath, removeRepo }`; `useTeamRepos(teamId)` returning `{ repos, loading, userLocalPaths, refresh, addRepo, updateUserLocalPath, removeRepo, setPermission }`.
- Produces:
  ```ts
  export type RepoScope = { kind: 'personal' } | { kind: 'team'; teamId: string }
  export interface Repo {
    id: string
    fullName: string
    url: string
    provider: 'github' | 'gitlab'
    addedAt: string
    localPath: string | null
    canAdd: boolean
  }
  export function useScopedRepos(scope: RepoScope, isTeamLeader?: boolean): {
    repos: Repo[]
    loading: boolean
    refresh: () => Promise<void>
    addRepo: (fullName: string, provider: 'github' | 'gitlab', localPath?: string | null) => Promise<boolean>
    updateLocalPath: (repoId: string, localPath: string | null) => Promise<void>
    removeRepo: (repoId: string) => Promise<void>
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/hooks/useScopedRepos.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useScopedRepos, type RepoScope } from '../../hooks/useScopedRepos'
import type { UserRepo } from '../../hooks/useUserRepos'
import type { TeamRepo } from '../../hooks/useTeamRepos'

const userState = {
  repos: [] as UserRepo[],
  loading: false,
  refresh: vi.fn(async () => {}),
  addRepo: vi.fn(async () => true),
  updateLocalPath: vi.fn(async () => {}),
  removeRepo: vi.fn(async () => {}),
}

const teamState = {
  repos: [] as TeamRepo[],
  loading: false,
  userLocalPaths: {} as Record<string, string>,
  refresh: vi.fn(async () => {}),
  addRepo: vi.fn(async () => true),
  updateUserLocalPath: vi.fn(async () => {}),
  removeRepo: vi.fn(async () => {}),
  setPermission: vi.fn(async () => {}),
}

let lastTeamId: string | null = null

vi.mock('../../hooks/useUserRepos', () => ({ useUserRepos: () => userState }))
vi.mock('../../hooks/useTeamRepos', () => ({
  useTeamRepos: (teamId: string | null) => { lastTeamId = teamId; return teamState },
}))

function userRepo(name: string, localPath: string | null = null): UserRepo {
  return {
    id: `u-${name}`, user_id: 'u1', repo_full_name: name,
    repo_url: `https://github.com/${name}`, added_at: '2026-09-01',
    local_path: localPath, provider: 'github',
  }
}

function teamRepo(name: string): TeamRepo {
  return {
    id: `t-${name}`, team_id: 'team1', repo_full_name: name,
    repo_url: `https://github.com/${name}`, added_by: 'u1',
    added_at: '2026-09-02', local_path: null, provider: 'github',
  }
}

describe('useScopedRepos', () => {
  beforeEach(() => {
    userState.repos = [userRepo('gero/raven-nest', 'C:/dev/raven-nest')]
    teamState.repos = []
    teamState.userLocalPaths = {}
    lastTeamId = null
    vi.clearAllMocks()
  })

  it('normalises personal repos and always allows adding', () => {
    const { result } = renderHook(() => useScopedRepos({ kind: 'personal' }))
    expect(result.current.repos).toEqual([{
      id: 'u-gero/raven-nest',
      fullName: 'gero/raven-nest',
      url: 'https://github.com/gero/raven-nest',
      provider: 'github',
      addedAt: '2026-09-01',
      localPath: 'C:/dev/raven-nest',
      canAdd: true,
    }])
  })

  it('passes null as the team id in personal scope so the team hook stays idle', () => {
    renderHook(() => useScopedRepos({ kind: 'personal' }))
    expect(lastTeamId).toBeNull()
  })

  // The team hook returns local_path: null and keeps the real paths in a
  // separate map (the column is deprecated since v1.2). The view must not know.
  it('folds userLocalPaths into localPath in team scope', () => {
    teamState.repos = [teamRepo('nest/api')]
    teamState.userLocalPaths = { 't-nest/api': 'D:/work/api' }
    const { result } = renderHook(() => useScopedRepos({ kind: 'team', teamId: 'team1' }))
    expect(result.current.repos[0].localPath).toBe('D:/work/api')
  })

  it('sets canAdd from isTeamLeader in team scope', () => {
    teamState.repos = [teamRepo('nest/api')]
    const asMember = renderHook(() => useScopedRepos({ kind: 'team', teamId: 'team1' }, false))
    expect(asMember.result.current.repos[0].canAdd).toBe(false)
    const asLeader = renderHook(() => useScopedRepos({ kind: 'team', teamId: 'team1' }, true))
    expect(asLeader.result.current.repos[0].canAdd).toBe(true)
  })

  // useTeamRepos has no useEffect of its own: nothing refreshes it.
  it('refreshes the team hook when the scope becomes a team', async () => {
    const { rerender } = renderHook(
      ({ scope }: { scope: RepoScope }) => useScopedRepos(scope),
      { initialProps: { scope: { kind: 'personal' } as RepoScope } },
    )
    expect(teamState.refresh).not.toHaveBeenCalled()
    rerender({ scope: { kind: 'team', teamId: 'team1' } })
    await waitFor(() => expect(teamState.refresh).toHaveBeenCalledTimes(1))
  })

  it('routes actions to the active scope', async () => {
    const { result } = renderHook(() => useScopedRepos({ kind: 'team', teamId: 'team1' }, true))
    await result.current.addRepo('nest/web', 'github', null)
    expect(teamState.addRepo).toHaveBeenCalledWith('nest/web', 'github', null)
    expect(userState.addRepo).not.toHaveBeenCalled()
    await result.current.updateLocalPath('t-x', 'C:/x')
    expect(teamState.updateUserLocalPath).toHaveBeenCalledWith('t-x', 'C:/x')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/hooks/useScopedRepos.test.tsx`
Expected: FAIL, cannot resolve `../../hooks/useScopedRepos`.

- [ ] **Step 3: Write the hook**

Create `src/hooks/useScopedRepos.ts`:

```ts
import { useCallback, useEffect, useMemo } from 'react'
import { useUserRepos } from './useUserRepos'
import { useTeamRepos } from './useTeamRepos'

export type RepoScope = { kind: 'personal' } | { kind: 'team'; teamId: string }

/** One repo, whoever owns it. `canAdd` is the only permission the list needs. */
export interface Repo {
  id: string
  fullName: string
  url: string
  provider: 'github' | 'gitlab'
  addedAt: string
  localPath: string | null
  canAdd: boolean
}

/**
 * Personal and team repos differ in two ways only: where the rows come from and
 * who may add one. Everything else (columns, local-path lookup, actions) is
 * already identical, so the view gets a single list and never branches on scope.
 */
export function useScopedRepos(scope: RepoScope, isTeamLeader = false) {
  const personal = useUserRepos()
  const teamId = scope.kind === 'team' ? scope.teamId : null
  const team = useTeamRepos(teamId)

  // useUserRepos refreshes itself on mount; useTeamRepos does not, and it has to
  // re-fetch whenever the selected team changes.
  const teamRefresh = team.refresh
  useEffect(() => {
    if (teamId) void teamRefresh()
  }, [teamId, teamRefresh])

  const repos = useMemo<Repo[]>(() => {
    if (scope.kind === 'personal') {
      return personal.repos.map(r => ({
        id: r.id,
        fullName: r.repo_full_name,
        url: r.repo_url,
        provider: r.provider,
        addedAt: r.added_at,
        localPath: r.local_path,
        canAdd: true,
      }))
    }
    return team.repos.map(r => ({
      id: r.id,
      fullName: r.repo_full_name,
      url: r.repo_url,
      provider: r.provider,
      addedAt: r.added_at,
      // The team row's own local_path is the deprecated v1.1 column and is
      // always null; the per-device path lives in userLocalPaths.
      localPath: team.userLocalPaths[r.id] ?? null,
      canAdd: isTeamLeader,
    }))
  }, [scope.kind, personal.repos, team.repos, team.userLocalPaths, isTeamLeader])

  const isTeam = scope.kind === 'team'

  const refresh = useCallback(async () => {
    await (isTeam ? team.refresh() : personal.refresh())
  }, [isTeam, team.refresh, personal.refresh])

  const addRepo = useCallback(async (
    fullName: string,
    provider: 'github' | 'gitlab',
    localPath?: string | null,
  ) => (isTeam
    ? team.addRepo(fullName, provider, localPath)
    : personal.addRepo(fullName, provider, localPath)),
  [isTeam, team.addRepo, personal.addRepo])

  const updateLocalPath = useCallback(async (repoId: string, localPath: string | null) => {
    await (isTeam ? team.updateUserLocalPath(repoId, localPath) : personal.updateLocalPath(repoId, localPath))
  }, [isTeam, team.updateUserLocalPath, personal.updateLocalPath])

  const removeRepo = useCallback(async (repoId: string) => {
    await (isTeam ? team.removeRepo(repoId) : personal.removeRepo(repoId))
  }, [isTeam, team.removeRepo, personal.removeRepo])

  return {
    repos,
    loading: isTeam ? team.loading : personal.loading,
    refresh,
    addRepo,
    updateLocalPath,
    removeRepo,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/hooks/useScopedRepos.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing test for the stale-response guard**

Append to `src/__tests__/hooks/useTeamRepos.test.ts` if it exists, otherwise create it:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTeamRepos } from '../../hooks/useTeamRepos'

const rows: Record<string, unknown[]> = {}
let resolvers: Array<() => void> = []

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_col: string, teamId: string) => ({
          order: () => new Promise(resolve => {
            resolvers.push(() => resolve({ data: rows[teamId] ?? [], error: null }))
          }),
        }),
      }),
    }),
  },
}))

describe('useTeamRepos stale responses', () => {
  beforeEach(() => {
    resolvers = []
    rows.A = [{ id: 'a1', team_id: 'A', repo_full_name: 'org/a', repo_url: 'u', added_by: 'x', added_at: '', provider: 'github' }]
    rows.B = [{ id: 'b1', team_id: 'B', repo_full_name: 'org/b', repo_url: 'u', added_by: 'x', added_at: '', provider: 'github' }]
    ;(window as unknown as { localPaths: unknown }).localPaths = { getAll: async () => ({}) }
  })

  it('ignores a fetch that resolves after the team changed', async () => {
    const { result, rerender } = renderHook(({ id }) => useTeamRepos(id), { initialProps: { id: 'A' } })
    await act(async () => { await result.current.refresh() })
    rerender({ id: 'B' })
    await act(async () => { await result.current.refresh() })
    // Resolve B first, then the stale A.
    await act(async () => { resolvers.reverse().forEach(r => r()) })
    await waitFor(() => expect(result.current.repos.map(r => r.id)).toEqual(['b1']))
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/__tests__/hooks/useTeamRepos.test.ts`
Expected: FAIL, the list ends up holding `a1`.

- [ ] **Step 7: Add the guard**

In `src/hooks/useTeamRepos.ts`, add a ref above `refresh` and check it after the await:

```ts
  // The id whose fetch is allowed to win. Switching teams mid-flight must not
  // let the slower response overwrite the newer team's list.
  const inFlightTeamId = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    if (!teamId) { setRepos([]); setUserLocalPaths({}); return }
    inFlightTeamId.current = teamId
    setLoading(true)

    const [reposRes, localPaths] = await Promise.all([/* unchanged */])
    if (inFlightTeamId.current !== teamId) return   // a newer scope won
```

Add `useRef` to the existing `react` import. Leave every other line of `refresh` untouched, including the `setLoading(false)` calls.

- [ ] **Step 8: Run both hook test files**

Run: `npx vitest run src/__tests__/hooks/useScopedRepos.test.tsx src/__tests__/hooks/useTeamRepos.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useScopedRepos.ts src/hooks/useTeamRepos.ts src/__tests__/hooks/useScopedRepos.test.tsx src/__tests__/hooks/useTeamRepos.test.ts
git commit -m "feat(repos): un solo tipo Repo para repos propios y de equipo"
```

---

### Task 2: `ScopeSelector`

**Files:**
- Create: `src/components/ScopeSelector.tsx`
- Test: `src/__tests__/components/ScopeSelector.test.tsx`

**Interfaces:**
- Consumes: `RepoScope` from Task 1; `Team` from `src/hooks/useTeam.ts`.
- Produces:
  ```ts
  interface ScopeSelectorProps {
    scope: RepoScope
    teams: Team[]
    allowTeam: boolean
    onScopeChange: (scope: RepoScope) => void
    onOpenTeamWorkspace: () => void
  }
  export default function ScopeSelector(props: ScopeSelectorProps): JSX.Element | null
  ```

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/components/ScopeSelector.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ScopeSelector from '../../components/ScopeSelector'
import type { Team } from '../../hooks/useTeam'

const team = (id: string, name: string): Team => ({ id, name, owner_id: 'u1', created_at: '' })
const noop = () => {}

describe('ScopeSelector', () => {
  it('renders nothing when the plan has no teams feature', () => {
    const { container } = render(
      <ScopeSelector scope={{ kind: 'personal' }} teams={[team('t1', 'Nest')]} allowTeam={false}
        onScopeChange={noop} onOpenTeamWorkspace={noop} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the user belongs to no team', () => {
    const { container } = render(
      <ScopeSelector scope={{ kind: 'personal' }} teams={[]} allowTeam
        onScopeChange={noop} onOpenTeamWorkspace={noop} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('lists Personal plus every team', () => {
    render(
      <ScopeSelector scope={{ kind: 'personal' }} teams={[team('t1', 'Nest'), team('t2', 'STI')]} allowTeam
        onScopeChange={noop} onOpenTeamWorkspace={noop} />,
    )
    expect(screen.getByRole('button', { name: 'Personal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nest' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'STI' })).toBeInTheDocument()
  })

  it('reports the picked scope', () => {
    const onScopeChange = vi.fn()
    render(
      <ScopeSelector scope={{ kind: 'personal' }} teams={[team('t1', 'Nest')]} allowTeam
        onScopeChange={onScopeChange} onOpenTeamWorkspace={noop} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Nest' }))
    expect(onScopeChange).toHaveBeenCalledWith({ kind: 'team', teamId: 't1' })
  })

  // The team workspace lost its sidebar door; this button is the only way in.
  it('offers the team workspace only while a team scope is active', () => {
    const { rerender } = render(
      <ScopeSelector scope={{ kind: 'personal' }} teams={[team('t1', 'Nest')]} allowTeam
        onScopeChange={noop} onOpenTeamWorkspace={noop} />,
    )
    expect(screen.queryByRole('button', { name: /team workspace/i })).not.toBeInTheDocument()
    rerender(
      <ScopeSelector scope={{ kind: 'team', teamId: 't1' }} teams={[team('t1', 'Nest')]} allowTeam
        onScopeChange={noop} onOpenTeamWorkspace={noop} />,
    )
    expect(screen.getByRole('button', { name: /team workspace/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/components/ScopeSelector.test.tsx`
Expected: FAIL, cannot resolve `../../components/ScopeSelector`.

- [ ] **Step 3: Write the component**

Create `src/components/ScopeSelector.tsx`:

```tsx
import type { RepoScope } from '../hooks/useScopedRepos'
import type { Team } from '../hooks/useTeam'

interface ScopeSelectorProps {
  scope: RepoScope
  teams: Team[]
  allowTeam: boolean
  onScopeChange: (scope: RepoScope) => void
  onOpenTeamWorkspace: () => void
}

/**
 * Switches the Personal surface between your own repos and each team's. Hidden
 * entirely for plans without teams and for users who belong to none: a lone
 * "Personal" chip would be a control that controls nothing.
 */
export default function ScopeSelector({
  scope, teams, allowTeam, onScopeChange, onOpenTeamWorkspace,
}: ScopeSelectorProps) {
  if (!allowTeam || teams.length === 0) return null

  return (
    <div className="scope-selector">
      <button
        type="button"
        className={`scope-chip${scope.kind === 'personal' ? ' active' : ''}`}
        onClick={() => onScopeChange({ kind: 'personal' })}
      >
        Personal
      </button>

      {teams.map(t => (
        <button
          key={t.id}
          type="button"
          className={`scope-chip${scope.kind === 'team' && scope.teamId === t.id ? ' active' : ''}`}
          onClick={() => onScopeChange({ kind: 'team', teamId: t.id })}
        >
          {t.name}
        </button>
      ))}

      {scope.kind === 'team' && (
        <button type="button" className="scope-open-team" onClick={onOpenTeamWorkspace}>
          Open team workspace
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Add the styles**

Append to `src/styles/global.css`, next to the other `tw-` rules. Reuse existing tokens; invent no new colors:

```css
/* Scope selector — Personal vs each team, at the top of the Personal nav. */
.scope-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
}
.scope-chip {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-muted);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: var(--ui-font-size);
  padding: 3px 8px;
}
.scope-chip:hover { color: var(--text-primary); }
.scope-chip.active {
  background: var(--bg-surface);
  border-color: var(--raven-blue);
  color: var(--text-primary);
}
.scope-open-team {
  background: transparent;
  border: none;
  color: var(--raven-blue);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: 11px;
  padding: 3px 4px;
  text-align: left;
  width: 100%;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/components/ScopeSelector.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/ScopeSelector.tsx src/__tests__/components/ScopeSelector.test.tsx src/styles/global.css
git commit -m "feat(personal): selector de scope entre lo propio y cada equipo"
```

---

### Task 3: `MyReposPanel` becomes `PersonalWorkspace`

**Files:**
- Rename: `src/components/MyReposPanel.tsx` to `src/components/PersonalWorkspace.tsx`
- Modify: `src/App.tsx:53` (the import), `src/App.tsx:1973-1981` (the mount)
- Test: `src/__tests__/components/PersonalWorkspace.test.tsx`

**Interfaces:**
- Consumes: `useScopedRepos` (Task 1), `ScopeSelector` (Task 2), `useTeam()` for `teams`, `members`, `userId`, `activeTeam`.
- Produces:
  ```ts
  interface PersonalWorkspaceProps {
    onClose: () => void
    githubToken: string | null
    githubLogin: string | null
    onConnectGitHub: () => void
    onOpenRepoTerminal: (repoFullName: string, localPath: string) => void
    onOpenTeamWorkspace: () => void
    allowTeam: boolean
    onStartTutorial?: () => void
  }
  ```

- [ ] **Step 1: Rename the file, keeping history**

```bash
git mv src/components/MyReposPanel.tsx src/components/PersonalWorkspace.tsx
```

Rename the component function and its props interface (`MyReposPanelProps` to `PersonalWorkspaceProps`), and change the header title from `My Repos` to `Personal` (the `tw-header-title` span, around line 285). Leave `data-tour-id="myrepos-header"` and `data-tour-id="myrepos-nav"` untouched: the tutorial targets them by name and retargeting the tour is out of scope.

- [ ] **Step 2: Write the failing test**

Create `src/__tests__/components/PersonalWorkspace.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import PersonalWorkspace from '../../components/PersonalWorkspace'
import type { Team, TeamMember, PendingInvite } from '../../hooks/useTeam'
import type { Repo } from '../../hooks/useScopedRepos'

const team = (id: string, name: string): Team => ({ id, name, owner_id: 'u1', created_at: '' })

const teamState = {
  teams: [] as Team[],
  activeTeam: null as Team | null,
  members: [] as TeamMember[],
  pendingInvites: [] as PendingInvite[],
  userId: 'u1',
  acceptInvite: vi.fn(async () => {}),
  rejectInvite: vi.fn(async () => {}),
}
const scopedState = {
  repos: [] as Repo[],
  loading: false,
  refresh: vi.fn(async () => {}),
  addRepo: vi.fn(async () => true),
  updateLocalPath: vi.fn(async () => {}),
  removeRepo: vi.fn(async () => {}),
}

vi.mock('../../hooks/useTeam', () => ({ useTeam: () => teamState }))
vi.mock('../../hooks/useScopedRepos', () => ({ useScopedRepos: () => scopedState }))
vi.mock('../../hooks/useGitHubNotifications', () => ({
  useGitHubNotifications: () => ({ notifications: [], unreadCount: 0, markAsRead: vi.fn() }),
}))
vi.mock('../../hooks/useGitlab', () => ({ useGitlab: () => ({ gitlabLogin: null, gitlabToken: null }) }))

const props = {
  onClose: vi.fn(),
  githubToken: 'gh-token',
  githubLogin: 'gero',
  onConnectGitHub: vi.fn(),
  onOpenRepoTerminal: vi.fn(),
  onOpenTeamWorkspace: vi.fn(),
  allowTeam: true,
}

describe('PersonalWorkspace', () => {
  beforeEach(() => {
    teamState.teams = []
    teamState.pendingInvites = []
    scopedState.repos = []
  })

  it('is titled Personal, not My Repos', () => {
    render(<PersonalWorkspace {...props} />)
    expect(screen.getByText('Personal')).toBeInTheDocument()
    expect(screen.queryByText('My Repos')).not.toBeInTheDocument()
  })

  it('hides the scope selector for a user with no teams', () => {
    render(<PersonalWorkspace {...props} />)
    expect(screen.queryByRole('button', { name: 'Nest' })).not.toBeInTheDocument()
  })

  it('shows the scope selector once the user belongs to a team', () => {
    teamState.teams = [team('t1', 'Nest')]
    render(<PersonalWorkspace {...props} />)
    expect(screen.getByRole('button', { name: 'Nest' })).toBeInTheDocument()
  })

  it('hides the scope selector when the plan has no teams', () => {
    teamState.teams = [team('t1', 'Nest')]
    render(<PersonalWorkspace {...props} allowTeam={false} />)
    expect(screen.queryByRole('button', { name: 'Nest' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/__tests__/components/PersonalWorkspace.test.tsx`
Expected: FAIL, the header still reads `My Repos` and no selector renders.

- [ ] **Step 4: Wire the scope into the component**

In `PersonalWorkspace.tsx`:

1. Replace the `useUserRepos` import and call with:

```tsx
import { useScopedRepos, type RepoScope, type Repo } from '../hooks/useScopedRepos'
import { useTeam } from '../hooks/useTeam'
import ScopeSelector from './ScopeSelector'
```

```tsx
  const [scope, setScope] = useState<RepoScope>({ kind: 'personal' })
  const { teams, members, userId } = useTeam()
  const isTeamLeader = scope.kind === 'team' && members.some(
    m => m.user_id === userId && m.role === 'leader',
  )
  const { repos, loading, refresh, addRepo, updateLocalPath, removeRepo } =
    useScopedRepos(scope, isTeamLeader)
```

2. Replace every `UserRepo` type annotation in the file with `Repo`, and every field access with the new names: `repo.repo_full_name` becomes `repo.fullName`, `repo.repo_url` becomes `repo.url`, `repo.local_path` becomes `repo.localPath`. `repo.id` and `repo.provider` are unchanged.

3. Render the selector as the first child of `<nav className="teams-workspace-nav">` (line 311), above the `NAV_ITEMS.map`:

```tsx
          <ScopeSelector
            scope={scope}
            teams={teams}
            allowTeam={allowTeam}
            onScopeChange={setScope}
            onOpenTeamWorkspace={onOpenTeamWorkspace}
          />
```

4. Gate the "Add repo" control on `canAdd`: the picker button renders only when `scope.kind === 'personal' || isTeamLeader`.

- [ ] **Step 5: Update the App mount**

In `src/App.tsx`, change the import on line 53 to `import PersonalWorkspace from './components/PersonalWorkspace'` and the mount at line 1973 to pass the new props (`onOpenTeamWorkspace={() => setTeamsOpen(true)}`, `allowTeam={planLimits.allowTeam}`). `myReposOpen` still drives it; Task 5 collapses the flags.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/components/PersonalWorkspace.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: green. `MyReposPanel` tests that import the old path must be updated to the new one; do not delete their assertions.

- [ ] **Step 8: Commit**

```bash
git add -A src/components src/__tests__ src/App.tsx
git commit -m "feat(personal): MyReposPanel pasa a ser PersonalWorkspace con scope"
```

---

### Task 4: Pending invites move to Personal

**Files:**
- Modify: `src/components/PersonalWorkspace.tsx` (NAV_ITEMS and the section router)
- Modify: `src/components/TeamsWorkspace.tsx:45` (the union), `:394`, `:463`, `:1049-1096`, `:1098`, `:1110`
- Test: `src/__tests__/components/PersonalWorkspace.test.tsx` (extend)

**Interfaces:**
- Consumes: `useTeam()` for `pendingInvites`, `acceptInvite(memberId)`, `rejectInvite(memberId)`.
- Produces: `Section` on `PersonalWorkspace` becomes `'activity' | 'repos' | 'issues' | 'standup' | 'pendings'`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/components/PersonalWorkspace.test.tsx`:

```tsx
  // Without this, someone in no team at all cannot accept the invite that would
  // put them in one: the Team door is gone from the sidebar.
  it('lets a user with zero teams reach their pending invites', () => {
    teamState.teams = []
    teamState.pendingInvites = [{
      memberId: 'm1', team: team('t9', 'Nest'), invitedAt: '2026-09-08',
    }]
    render(<PersonalWorkspace {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /invites/i }))
    expect(screen.getByText('Nest')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument()
  })

  it('shows the invite count on the nav item', () => {
    teamState.pendingInvites = [
      { memberId: 'm1', team: team('t9', 'Nest'), invitedAt: '' },
      { memberId: 'm2', team: team('t8', 'STI'), invitedAt: '' },
    ]
    render(<PersonalWorkspace {...props} />)
    expect(screen.getByRole('button', { name: /invites/i })).toHaveTextContent('2')
  })
```

Add `fireEvent` to the `@testing-library/react` import at the top of the file.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/components/PersonalWorkspace.test.tsx`
Expected: FAIL, no `Invites` nav item exists.

- [ ] **Step 3: Add the section**

In `PersonalWorkspace.tsx`, extend the `Section` type with `'pendings'` and append to `NAV_ITEMS`:

```tsx
    {
      id: 'pendings',
      label: pendingInvites.length > 0 ? `Invites (${pendingInvites.length})` : 'Invites',
      icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4.5h12v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M2 5l6 4 6-4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
    },
```

Move the JSX of the `pendings` section from `TeamsWorkspace.tsx:1049-1096` verbatim into `PersonalWorkspace.tsx` as `{section === 'pendings' && ( ... )}`, and take `pendingInvites`, `acceptInvite` and `rejectInvite` from the `useTeam()` call added in Task 3.

- [ ] **Step 4: Remove it from `TeamsWorkspace`**

Delete `'pendings'` from the `WorkspaceSection` union on line 45, the nav entry at line 394, and the block at lines 1049-1096. The three `setSection('pendings')` call sites (lines 463, 1098, 1110) become `onOpenPersonalInvites?.()`, a new optional prop that `App.tsx` wires to open `PersonalWorkspace` on its pendings section.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/__tests__/components/PersonalWorkspace.test.tsx src/__tests__/components/TeamsWorkspace.test.tsx`
Expected: PASS. TeamsWorkspace tests asserting the pendings section must be deleted, not weakened; their coverage now lives in the PersonalWorkspace test.

- [ ] **Step 6: Commit**

```bash
git add -A src/components src/__tests__
git commit -m "feat(personal): las invitaciones pendientes se mudan a Personal"
```

---

### Task 5: One `Personal` door in the sidebar

**Files:**
- Modify: `src/components/SidebarTabBar.tsx:71` (`REPO_TABS`)
- Modify: `src/components/Sidebar.tsx` (lines 24, 123-127, 575-637, 742-743, 757, 774-775)
- Delete: `src/components/PersonalPanel.tsx`, `src/__tests__/components/PersonalPanel.test.tsx`
- Modify: `src/App.tsx:1704-1712`, `:1961-1981`
- Test: `src/__tests__/components/Sidebar-tabs.test.tsx` (rewrite the tab assertions)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Sidebar` prop `onPersonalOpen: () => void` replaces `onTeamsOpen` and `onMyReposOpen`. `App` state `personalOpen: boolean` replaces `myReposOpen`; `teamsOpen` survives, now opened only from `ScopeSelector`.

- [ ] **Step 1: Write the failing test**

Rewrite the tab expectations in `src/__tests__/components/Sidebar-tabs.test.tsx` and add:

```tsx
  it('shows three tabs, without Personal', () => {
    renderSidebar()
    expect(screen.getByRole('tab', { name: 'Worktrees' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Explorer' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Personal' })).not.toBeInTheDocument()
  })

  it('puts a single Personal row above the user menu', () => {
    renderSidebar()
    expect(screen.getByTitle(/^Personal/)).toBeInTheDocument()
    expect(screen.queryByText('Team')).not.toBeInTheDocument()
    expect(screen.queryByText('Repos')).not.toBeInTheDocument()
  })

  it('badges the Personal row with the pending invite count', () => {
    renderSidebar({ pendingInvitesCount: 3 })
    expect(screen.getByLabelText('3 pending invites')).toBeInTheDocument()
  })

  it('sends Free users to the upgrade modal instead of Personal', () => {
    const onUpgrade = vi.fn()
    const onPersonalOpen = vi.fn()
    renderSidebar({ plan: 'free', onUpgrade, onPersonalOpen })
    fireEvent.click(screen.getByTitle(/^Personal/))
    expect(onUpgrade).toHaveBeenCalled()
    expect(onPersonalOpen).not.toHaveBeenCalled()
  })
```

`renderSidebar` is the existing helper in that file; extend its props object rather than writing a second helper.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/components/Sidebar-tabs.test.tsx`
Expected: FAIL, four tabs render and no Personal row exists.

- [ ] **Step 3: Drop the tab**

In `SidebarTabBar.tsx` line 71:

```tsx
export const REPO_TABS = ['worktrees', 'explorer', 'tools'] as const
```

Also delete `'personal'` from the `SidebarTabId` union, its `TAB_DEFS` entry and the `PersonalIcon` constant: no tab list references it any more, and the footer row draws its own icon. The `pendingInvitesCount` prop on `SidebarTabBar` and the `sidebar-tab-badge` branch go with it, since the badge now lives on the footer row.

- [ ] **Step 4: Replace the two rows with one**

In `Sidebar.tsx`, delete `TeamItem` (575-617) and `MyReposItem` (619-637) and put in their place:

```tsx
  // One door for everything that is yours: your repos, each team's repos, and
  // your pending invites. Free plans hit the upgrade modal, as My Repos did.
  const PersonalItem = (
    <div
      className="sidebar-item sidebar-item-panel sidebar-item-team"
      style={{ cursor: 'pointer', position: 'relative' }}
      onClick={plan === 'free' ? onUpgrade : onPersonalOpen}
      title={pendingInvitesCount > 0
        ? `Personal — ${pendingInvitesCount} pending invite${pendingInvitesCount === 1 ? '' : 's'}`
        : 'Personal'}
    >
      <span className="sidebar-icon" style={{ position: 'relative' }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M3 13.5c0-2.5 2.24-4.5 5-4.5s5 2 5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        {pendingInvitesCount > 0 && (
          <span
            aria-label={`${pendingInvitesCount} pending invites`}
            style={{
              position: 'absolute', top: -4, right: -6, minWidth: 14, height: 14,
              padding: '0 3px', borderRadius: 7, background: '#EF4444', color: '#fff',
              fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center',
              justifyContent: 'center', lineHeight: 1,
              boxShadow: '0 0 0 1.5px var(--bg-primary, #0a0a0a)',
            }}
          >
            {pendingInvitesCount > 9 ? '9+' : pendingInvitesCount}
          </span>
        )}
      </span>
      <span className="sidebar-label">Personal</span>
      {expanded && plan === 'free' && <span className="sidebar-plan-badge">Pro</span>}
    </div>
  )
```

Replace the three usages: lines 742-743 and 774-775 render `{PersonalItem}` instead of the pair, and line 757 (the `<PersonalPanel .../>` inside the tab body) is deleted along with its wrapper. Render `{PersonalItem}` immediately above the `<UserMenu ... />` block so it sits directly on top of the user row, matching the reference screenshot.

Swap the props: `onTeamsOpen` and `onMyReposOpen` become a single `onPersonalOpen: () => void` in the `Props` interface and in the destructuring on line 96. Remove the `PersonalPanel` import on line 24.

- [ ] **Step 5: Delete the superseded component**

```bash
git rm src/components/PersonalPanel.tsx src/__tests__/components/PersonalPanel.test.tsx
```

- [ ] **Step 6: Collapse the App flags**

In `src/App.tsx`, replace the two handlers at lines 1704-1712 with:

```tsx
        onPersonalOpen={() => {
          if (!planLimits.allowMyRepos) { setShowUpgrade(true); return }
          setPersonalOpen(true)
        }}
```

Rename the `myReposOpen` state to `personalOpen`. Keep `teamsOpen`: it is now set only by `ScopeSelector` through `onOpenTeamWorkspace`, and cleared by the workspace's own `onClose`.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: green, with the count down by the deleted `PersonalPanel` tests.

- [ ] **Step 8: Typecheck**

Run: `npx tsc -b`
Expected: only the ~13 pre-existing errors. Then:

```bash
git add src/components/ScopeSelector.tsx src/hooks/useScopedRepos.ts src/components/PersonalWorkspace.tsx
git clean -fd
```

The `git add` comes first on purpose: `git clean -fd` deletes every untracked file and cannot tell a new `.tsx` from an emitted `.js`.

- [ ] **Step 9: Commit**

```bash
git add -A src
git commit -m "feat(sidebar): una sola puerta Personal encima del usuario"
```

---

### Task 6: Strip the duplicated sections from `TeamsWorkspace`

**Files:**
- Modify: `src/components/TeamsWorkspace.tsx` (the `WorkspaceSection` union on line 45, `NAV_ITEMS` around line 367-394, the `activity`, `repos` and `issues` section blocks, and the now-unused imports)
- Test: `src/__tests__/components/TeamsWorkspace.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `WorkspaceSection` becomes `'chat' | 'members' | 'stats' | 'snippets' | 'workspaces' | 'mcp'`; the default section becomes `'chat'`.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/components/TeamsWorkspace.test.tsx`:

```tsx
  it('no longer offers the sections that moved to Personal', () => {
    renderWorkspace()
    for (const label of ['Activity', 'Repos', 'Issues', 'Pendings']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
  })

  it('keeps the collaboration sections', () => {
    renderWorkspace()
    for (const label of ['Chat', 'Members', 'Stats', 'Snippets', 'Workspaces', 'MCP']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })
```

`renderWorkspace` is the existing helper in that file.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/components/TeamsWorkspace.test.tsx`
Expected: FAIL, the four nav buttons still render.

- [ ] **Step 3: Delete the sections**

Remove from `TeamsWorkspace.tsx`:
- `'activity'`, `'repos'` and `'issues'` from the `WorkspaceSection` union (line 45) and their `NAV_ITEMS` entries.
- The `reposView` / `issuesView` state and their `ReposView` / `IssuesView` types.
- The three section render blocks.
- The imports that become unused: `PRList`, `PRReview`, `IssueList`, `IssueDetail`, `ActivityFeed`, `DailyStandup`, `RepoCIBadge`, `RepoActionsAccordion`, `RepoActionsMenu`, `RepoPicker`, `RepoStatusPanel`, `useTeamRepos`, `useGitHubNotifications`.
- Change the initial section to `useState<WorkspaceSection>('chat')`.

Keep `useGitHub` and `useGitlab` only if a surviving section still uses them; if the typecheck says they are unused, remove them too.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: green.

- [ ] **Step 5: Typecheck and clean**

Run: `npx tsc -b`, then `git clean -fd` (nothing new is untracked at this point, every source file is committed).
Expected: only the ~13 pre-existing errors.

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "refactor(teams): el workspace del equipo se queda solo con lo que es de equipo"
```

---

## Manual verification

After Task 6, run the app from the worktree and check the five things the automated tests cannot:

```bash
npm run dev -- -- --user-data-dir="C:/Users/gerod/.raven-nest/accounts/claude/Gero Personal/AppData/Roaming/nest-sidebar"
```

1. The sidebar shows three tabs and a single `Personal` row sitting directly above the user avatar.
2. Opening Personal lands on Repos with the scope selector on top; switching to a team swaps the list without a flash of the previous team's repos.
3. "Open team workspace" opens the team surface, and closing it returns to Personal.
4. With a pending invite, the badge shows on the `Personal` row and the invite is acceptable from inside.
5. On a Free account the row opens the upgrade modal.

Close the app before the next `npm test`: two Electron instances with their PTYs have already exhausted this machine's memory once (2026-09-08).
