import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { isE2EPreview } from '../lib/e2ePreview'
import { FX_SNIPPETS, FX_USER_ID } from '../lib/e2eFixtures'

export interface SharedSnippet {
  id: string
  owner_id: string
  name: string
  content: string
  created_at: string
}

export function useSharedSnippets(teamId?: string) {
  const [items, setItems] = useState<SharedSnippet[]>([])
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('shared_snippets')
      .select('*')
      .order('created_at', { ascending: false })
    if (teamId) {
      query = query.eq('team_id', teamId)
    } else {
      query = query.is('team_id', null)
    }
    const { data, error } = await query
    if (error) {
      console.warn('[useSharedSnippets.refresh] select failed; keeping previous state', { teamId }, error)
      setLoading(false)
      return
    }
    setItems(data ?? [])
    setLoading(false)
  }, [teamId])

  const share = useCallback(async (name: string, content: string, teamId?: string): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const { error } = await supabase.from('shared_snippets').insert({ owner_id: user.id, name, content, team_id: teamId ?? null })
    if (error) console.warn('[useSharedSnippets.share] insert failed', { name, teamId }, error)
    if (!error) refresh()
    return !error
  }, [refresh])

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from('shared_snippets').delete().eq('id', id)
    if (error) {
      console.warn('[useSharedSnippets.remove] delete failed; keeping item in state', { id }, error)
      return
    }
    setItems(prev => prev.filter(i => i.id !== id))
  }, [])

  if (isE2EPreview()) {
    return {
      items: FX_SNIPPETS as SharedSnippet[],
      loading: false,
      userId: FX_USER_ID,
      refresh: async () => {},
      share: async () => true,
      remove: async () => {},
    }
  }

  return { items, loading, userId, refresh, share, remove }
}
