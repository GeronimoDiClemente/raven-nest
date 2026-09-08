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
