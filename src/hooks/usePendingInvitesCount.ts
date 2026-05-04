import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function usePendingInvitesCount() {
  const [count, setCount] = useState(0)

  const refresh = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) { setCount(0); return }
    const { count: c } = await supabase
      .from('team_members')
      .select('id', { count: 'exact', head: true })
      .eq('email', user.email)
      .eq('status', 'pending')
    setCount(c ?? 0)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(() => { refresh() })
    return () => { sub.subscription.unsubscribe() }
  }, [refresh])

  return { count, refresh }
}
