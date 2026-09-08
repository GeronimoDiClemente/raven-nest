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
