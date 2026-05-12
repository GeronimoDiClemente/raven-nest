import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface SharedMcpConfig {
  id: string
  owner_id: string
  name: string
  config: Record<string, unknown>
  team_id: string | null
  created_at: string
}

export function useSharedMcpConfigs(teamId?: string) {
  const [items, setItems] = useState<SharedMcpConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('shared_mcp_configs')
      .select('*')
      .order('created_at', { ascending: false })
    if (teamId) {
      query = query.eq('team_id', teamId)
    } else {
      query = query.is('team_id', null)
    }
    const { data, error } = await query
    if (error) {
      console.warn('[useSharedMcpConfigs.refresh] select failed; keeping previous state', { teamId }, error)
      setLoading(false)
      return
    }
    setItems(data ?? [])
    setLoading(false)
  }, [teamId])

  const share = useCallback(async (name: string, config: Record<string, unknown>, teamId?: string): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const { error } = await supabase.from('shared_mcp_configs').insert({
      owner_id: user.id,
      name,
      config,
      team_id: teamId ?? null,
    })
    if (error) console.warn('[useSharedMcpConfigs.share] insert failed', { name, teamId }, error)
    if (!error) refresh()
    return !error
  }, [refresh])

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from('shared_mcp_configs').delete().eq('id', id)
    if (error) {
      console.warn('[useSharedMcpConfigs.remove] delete failed; keeping item in state', { id }, error)
      return
    }
    setItems(prev => prev.filter(i => i.id !== id))
  }, [])

  return { items, loading, userId, refresh, share, remove }
}
