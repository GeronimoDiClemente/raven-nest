import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Workspace } from '../types'

export interface SharedWorkspace {
  id: string
  owner_id: string
  name: string
  data: Workspace
  created_at: string
}

export function useSharedWorkspaces(teamId?: string) {
  const [items, setItems] = useState<SharedWorkspace[]>([])
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('shared_workspaces')
      .select('*')
      .order('created_at', { ascending: false })
    if (teamId) {
      query = query.eq('team_id', teamId)
    } else {
      query = query.is('team_id', null)
    }
    const { data, error } = await query
    if (error) {
      console.warn('[useSharedWorkspaces.refresh] select failed; keeping previous state', { teamId }, error)
      setLoading(false)
      return
    }
    setItems(data ?? [])
    setLoading(false)
  }, [teamId])

  const share = useCallback(async (ws: Workspace, teamId?: string): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const { error } = await supabase.from('shared_workspaces').insert({
      owner_id: user.id,
      name: ws.name,
      data: ws,
      team_id: teamId ?? null,
    })
    if (error) console.warn('[useSharedWorkspaces.share] insert failed', { name: ws.name, teamId }, error)
    if (!error) refresh()
    return !error
  }, [refresh])

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from('shared_workspaces').delete().eq('id', id)
    if (error) {
      console.warn('[useSharedWorkspaces.remove] delete failed; keeping item in state', { id }, error)
      return
    }
    setItems(prev => prev.filter(i => i.id !== id))
  }, [])

  return { items, loading, userId, refresh, share, remove }
}
