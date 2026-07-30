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
