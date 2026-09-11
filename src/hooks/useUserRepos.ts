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
    // Override E2E (RAVEN_E2E_REPOS): gateado DOBLE al bypass, igual que
    // e2ePlan en useProfile — en una sesion real e2eBypass es false y esto
    // nunca corre. Existe porque My Repos no se puede ver renderizado sin una
    // cuenta GitHub conectada, y esa ceguera ya produjo una "excepcion" de
    // escala documentada en global.css que era falsa.
    const seed = window.appFlags?.e2eBypass ? window.appFlags.e2eRepos : null
    if (seed) {
      try {
        setRepos(JSON.parse(seed) as UserRepo[])
      } catch (err) {
        console.warn('[useUserRepos.refresh] RAVEN_E2E_REPOS no es JSON valido', err)
      }
      setLoading(false)
      return
    }
    setLoading(true)
    // This runs unawaited from a passive effect (see below), so any rejection
    // here — a network failure, a dropped IPC call to window.localPaths — must
    // be caught locally. Otherwise it escapes as an unhandled rejection instead
    // of the "keep previous state" behavior the rest of this hook relies on.
    try {
      const [reposRes, localPaths] = await Promise.all([
        supabase
          .from('user_repos')
          .select('id, user_id, repo_full_name, repo_url, added_at, provider')
          .order('added_at', { ascending: false }),
        window.localPaths.getAll(),
      ])
      if (reposRes.error) {
        console.warn('[useUserRepos.refresh] select user_repos failed; keeping previous state', reposRes.error)
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
    } catch (err) {
      console.warn('[useUserRepos.refresh] unexpected error; keeping previous state', err)
    } finally {
      setLoading(false)
    }
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
