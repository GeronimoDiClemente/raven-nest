import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { PROVIDER_HOST } from '../components/ProviderAvatar'

export interface TeamRepo {
  id: string
  team_id: string
  repo_full_name: string  // "owner/repo"
  repo_url: string
  added_by: string
  added_at: string
  local_path: string | null
  provider: 'github' | 'gitlab'
}

export interface TeamRepoPermission {
  id: string
  team_repo_id: string
  user_id: string
  permission: 'read' | 'write' | 'admin'
}

export function useTeamRepos(teamId: string | null) {
  const [repos, setRepos] = useState<TeamRepo[]>([])
  const [loading, setLoading] = useState(false)
  // Per-user local paths: team_repo_id → local_path
  const [userLocalPaths, setUserLocalPaths] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    if (!teamId) { setRepos([]); setUserLocalPaths({}); return }
    setLoading(true)

    const [{ data: reposData, error: reposError }, { data: { user } }] = await Promise.all([
      supabase
        .from('team_repos')
        .select('*')
        .eq('team_id', teamId)
        .order('added_at', { ascending: false }),
      supabase.auth.getUser(),
    ])
    if (reposError) {
      console.warn('[useTeamRepos.refresh] select team_repos failed; keeping previous state', { teamId }, reposError)
      setLoading(false)
      return
    }
    setRepos((reposData ?? []) as TeamRepo[])

    if (user) {
      const { data: pathsData, error: pathsError } = await supabase
        .from('team_repo_local_paths')
        .select('team_repo_id, local_path')
        .eq('user_id', user.id)
      if (pathsError) {
        console.warn('[useTeamRepos.refresh] select team_repo_local_paths failed; keeping previous paths', { teamId, userId: user.id }, pathsError)
      } else {
        const map: Record<string, string> = {}
        for (const row of pathsData ?? []) {
          map[(row as { team_repo_id: string; local_path: string }).team_repo_id] =
            (row as { team_repo_id: string; local_path: string }).local_path
        }
        setUserLocalPaths(map)
      }
    }

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
    const { data: inserted, error } = await supabase
      .from('team_repos')
      .insert({
        team_id: teamId,
        repo_full_name: repoFullName,
        repo_url: repoUrl,
        added_by: user.id,
        local_path: localPath ?? null,
        provider,
      })
      .select('id')
      .single()

    if (error || !inserted) {
      if (error) console.warn('[useTeamRepos.addRepo] insert team_repos failed', { teamId, repoFullName, provider }, error)
      return false
    }

    // Also save per-user path if provided
    if (localPath) {
      const { error: pathError } = await supabase.from('team_repo_local_paths').upsert(
        { team_repo_id: inserted.id, user_id: user.id, local_path: localPath, updated_at: new Date().toISOString() },
        { onConflict: 'team_repo_id,user_id' }
      )
      if (pathError) console.warn('[useTeamRepos.addRepo] upsert team_repo_local_paths failed', { repoId: inserted.id }, pathError)
    }

    await refresh()
    return true
  }, [teamId, refresh])

  /** Update the current user's personal local path for a team repo. */
  const updateUserLocalPath = useCallback(async (repoId: string, localPath: string | null) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    if (localPath) {
      const { error } = await supabase.from('team_repo_local_paths').upsert(
        { team_repo_id: repoId, user_id: user.id, local_path: localPath, updated_at: new Date().toISOString() },
        { onConflict: 'team_repo_id,user_id' }
      )
      if (error) {
        console.warn('[useTeamRepos.updateUserLocalPath] upsert failed; keeping previous path', { repoId }, error)
        return
      }
      setUserLocalPaths(prev => ({ ...prev, [repoId]: localPath }))
    } else {
      const { error } = await supabase.from('team_repo_local_paths').delete()
        .eq('team_repo_id', repoId).eq('user_id', user.id)
      if (error) {
        console.warn('[useTeamRepos.updateUserLocalPath] delete failed; keeping previous path', { repoId }, error)
        return
      }
      setUserLocalPaths(prev => { const next = { ...prev }; delete next[repoId]; return next })
    }
  }, [])

  /** Legacy: update the shared team path (kept for backwards compat, prefer updateUserLocalPath). */
  const updateLocalPath = useCallback(async (repoId: string, localPath: string | null) => {
    const { error } = await supabase.from('team_repos').update({ local_path: localPath }).eq('id', repoId)
    if (error) console.warn('[useTeamRepos.updateLocalPath] update failed', { repoId }, error)
    await refresh()
  }, [refresh])

  const removeRepo = useCallback(async (repoId: string) => {
    const { error } = await supabase.from('team_repos').delete().eq('id', repoId)
    if (error) console.warn('[useTeamRepos.removeRepo] delete failed', { repoId }, error)
    await refresh()
  }, [refresh])

  const setPermission = useCallback(async (
    repoId: string, userId: string, permission: 'read' | 'write' | 'admin'
  ) => {
    const { error } = await supabase
      .from('team_repo_permissions')
      .upsert({ team_repo_id: repoId, user_id: userId, permission }, { onConflict: 'team_repo_id,user_id' })
    if (error) console.warn('[useTeamRepos.setPermission] upsert failed', { repoId, userId, permission }, error)
  }, [])

  return { repos, loading, userLocalPaths, refresh, addRepo, updateUserLocalPath, updateLocalPath, removeRepo, setPermission }
}
