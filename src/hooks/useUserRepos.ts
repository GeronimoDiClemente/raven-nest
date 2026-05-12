import { useState, useCallback } from 'react'
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

export function useUserRepos() {
  const [repos, setRepos] = useState<UserRepo[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('user_repos')
      .select('*')
      .order('added_at', { ascending: false })
    if (error) {
      console.warn('[useUserRepos.refresh] select user_repos failed; keeping previous state', error)
      setLoading(false)
      return
    }
    setRepos((data ?? []).map((r: UserRepo) => ({ ...r, provider: r.provider ?? 'github' })))
    setLoading(false)
  }, [])

  const addRepo = useCallback(async (repoFullName: string, provider: 'github' | 'gitlab', localPath?: string | null): Promise<boolean> => {
    const repoUrl = provider === 'gitlab'
      ? `https://gitlab.com/${repoFullName}`
      : `https://github.com/${repoFullName}`
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const { error } = await supabase
      .from('user_repos')
      .insert({
        user_id: user.id,
        repo_full_name: repoFullName,
        repo_url: repoUrl,
        local_path: localPath ?? null,
        provider,
      })
    if (error) console.warn('[useUserRepos.addRepo] insert failed', { repoFullName, provider }, error)
    if (!error) await refresh()
    return !error
  }, [refresh])

  const updateLocalPath = useCallback(async (repoId: string, localPath: string | null) => {
    const { error } = await supabase.from('user_repos').update({ local_path: localPath }).eq('id', repoId)
    if (error) console.warn('[useUserRepos.updateLocalPath] update failed', { repoId }, error)
    await refresh()
  }, [refresh])

  const removeRepo = useCallback(async (repoId: string) => {
    const { error } = await supabase.from('user_repos').delete().eq('id', repoId)
    if (error) console.warn('[useUserRepos.removeRepo] delete failed', { repoId }, error)
    await refresh()
  }, [refresh])

  return { repos, loading, refresh, addRepo, updateLocalPath, removeRepo }
}
