import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useTeamJoinCode(teamId: string | null) {
  const [code, setCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!teamId) { setCode(null); return }
    setLoading(true)
    setError(null)
    const { data, error: e } = await supabase
      .from('team_join_codes')
      .select('code')
      .eq('team_id', teamId)
      .is('revoked_at', null)
      .maybeSingle()
    if (e) setError(e.message)
    setCode(data?.code ?? null)
    setLoading(false)
  }, [teamId])

  useEffect(() => { fetch() }, [fetch])

  const regenerate = useCallback(async (): Promise<{ ok: boolean; code?: string; error?: string }> => {
    if (!teamId) return { ok: false, error: 'No team' }
    const { data, error: e } = await supabase.rpc('generate_team_join_code', { p_team_id: teamId })
    if (e) return { ok: false, error: e.message }
    setCode(data ?? null)
    return { ok: true, code: data ?? undefined }
  }, [teamId])

  return { code, loading, error, refresh: fetch, regenerate }
}
