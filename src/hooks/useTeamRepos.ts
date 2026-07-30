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
      local_path: null,
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
