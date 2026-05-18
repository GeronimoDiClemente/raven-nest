import { useState, useEffect, useCallback, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export interface PresenceState {
  userId: string
  displayName: string  // email o nombre
  repo: string | null
  branch: string | null
  lastSeen: string
}

export function useTeamPresence(teamId: string | null, currentUserId: string | null) {
  const [presence, setPresence] = useState<Record<string, PresenceState>>({})
  // H5: Hold the subscribed channel so updatePresence can call .track() on it.
  // Previously updatePresence created a NEW channel and never subscribed it,
  // so the track() call silently dropped on the floor.
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    if (!teamId || !currentUserId) return

    const channel = supabase.channel(`team-presence:${teamId}`, {
      config: { presence: { key: currentUserId } }
    })
    channelRef.current = channel

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceState>()
        const flat: Record<string, PresenceState> = {}
        for (const [key, users] of Object.entries(state)) {
          if (users.length > 0) flat[key] = users[0] as PresenceState
        }
        setPresence(flat)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          const { data: { user } } = await supabase.auth.getUser()
          await channel.track({
            userId: currentUserId,
            displayName: user?.email ?? currentUserId,
            repo: null,
            branch: null,
            lastSeen: new Date().toISOString(),
          })
        }
      })

    return () => {
      channelRef.current = null
      // Explicit untrack() so teammates see us go offline immediately,
      // instead of waiting for the heartbeat timeout to expire.
      ;(async () => {
        try { await channel.untrack() } catch { /* best-effort */ }
        supabase.removeChannel(channel)
      })()
    }
  }, [teamId, currentUserId])

  const updatePresence = useCallback(async (
    repo: string | null,
    branch: string | null
  ) => {
    if (!teamId || !currentUserId) return
    const channel = channelRef.current
    if (!channel) return
    const { data: { user } } = await supabase.auth.getUser()
    await channel.track({
      userId: currentUserId,
      displayName: user?.email ?? currentUserId,
      repo,
      branch,
      lastSeen: new Date().toISOString(),
    })
  }, [teamId, currentUserId])

  return { presence, updatePresence }
}
