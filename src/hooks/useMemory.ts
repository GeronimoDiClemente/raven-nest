import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

// Nest Memory Connect card state machine — docs/nest-memory-architecture.md §8.1.
// `migrating` covers both the connect-time import (§5.4) and the brief window before the
// first status poll resolves; Phase 1 shows a single spinner rather than the full
// per-source checklist UI (§5.4's line-by-line progress), which is a Phase 3 dashboard
// refinement, not a Phase 1 acceptance requirement.
export type MemoryCardState = 'disconnected' | 'connecting' | 'migrating' | 'connected' | 'paused' | 'error'

interface MemoryHookState {
  state: MemoryCardState
  itemCount: number
  pendingCount: number
  deviceId: string | null
  error: string | null
}

export function useMemory() {
  const [state, setState] = useState<MemoryHookState>({
    state: 'disconnected',
    itemCount: 0,
    pendingCount: 0,
    deviceId: null,
    error: null,
  })
  // Guards refresh() from clobbering an in-flight connect()'s 'migrating' state with a
  // stale 'disconnected' read that a background status poll could otherwise race in.
  const connectingRef = useRef(false)

  const refresh = useCallback(async () => {
    const status = await window.memory.status()
    if (connectingRef.current) return
    setState((s) => ({
      ...s,
      state: !status.connected
        ? 'disconnected'
        : status.daemonStatus === 'paused'
          ? 'paused'
          : status.daemonStatus === 'error'
            ? 'error'
            : 'connected',
      itemCount: status.itemCount,
      pendingCount: status.pendingCount,
      deviceId: status.deviceId,
    }))
  }, [])

  useEffect(() => {
    refresh()
    window.memory.onStatus(() => { void refresh() })
    return () => window.memory.removeStatusListener()
  }, [refresh])

  const connect = useCallback(async () => {
    connectingRef.current = true
    setState((s) => ({ ...s, state: 'connecting', error: null }))
    try {
      const deviceId = await window.memory.ensureDeviceId()
      setState((s) => ({ ...s, state: 'migrating' }))

      const { data, error } = await supabase.functions.invoke('memory-token', {
        body: { action: 'issue', device: { name: navigator.platform || 'Device', platform: navigator.platform } },
      })
      if (error) throw error

      const result = await window.memory.connect(data.token, data.device_id ?? deviceId)
      if (!result.ok) throw new Error(result.error ?? 'Connect failed')

      connectingRef.current = false
      await refresh()
    } catch (err) {
      connectingRef.current = false
      setState((s) => ({ ...s, state: 'error', error: err instanceof Error ? err.message : String(err) }))
    }
  }, [refresh])

  const disconnect = useCallback(async (deleteCloud = false) => {
    try {
      // §7.5 / §6.6 "Right to delete" — best-effort; local data is never touched by this.
      // Ordering matters: window.memory.disconnect() authenticates its delete-cloud-data
      // call with the locally stored nmk_ token, so it MUST run before we revoke that same
      // token below. Revoking first (the old order) made the server reject the delete
      // request with 401 revoked_token, silently leaving all cloud data intact.
      await window.memory.disconnect({ deleteCloud })
      if (deleteCloud) {
        await supabase.functions.invoke('memory-token', { body: { action: 'revoke', all: true } })
      }
      await refresh()
    } catch (err) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }))
    }
  }, [refresh])

  return { ...state, connect, disconnect, refresh }
}
