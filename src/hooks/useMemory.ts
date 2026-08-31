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

/**
 * `window.memory` puede no estar expuesta: el preload la publica solo cuando el
 * subsistema de memoria levanto bien, y `main.ts` ya trata a memoria como algo que
 * puede fallar y degradar. Este hook era la unica pieza que asumia que siempre esta,
 * asi que montar `SettingsPanel` sin ella tiraba
 * `Cannot read properties of undefined (reading 'onStatus')` y se llevaba puesto todo
 * el arbol que lo contuviera. Es el bug 3.4 de docs/MEMORY_INTEGRATIONS_CONTRACT.md:
 * aparece solo al juntar esta rama con la de integrations, porque ninguna de las dos
 * monta el panel sin la API.
 */
function memoryApi(): typeof window.memory | undefined {
  return typeof window === 'undefined' ? undefined : window.memory
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
    const api = memoryApi()
    if (!api) return
    const status = await api.status()
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
    const api = memoryApi()
    if (!api) return
    refresh()
    api.onStatus(() => { void refresh() })
    return () => api.removeStatusListener()
  }, [refresh])

  const connect = useCallback(async () => {
    connectingRef.current = true
    setState((s) => ({ ...s, state: 'connecting', error: null }))
    try {
      const api = memoryApi()
      if (!api) throw new Error('Memory is not available in this build')
      const deviceId = await api.ensureDeviceId()
      setState((s) => ({ ...s, state: 'migrating' }))

      const { data, error } = await supabase.functions.invoke('memory-token', {
        body: { action: 'issue', device: { name: navigator.platform || 'Device', platform: navigator.platform } },
      })
      if (error) throw error

      const result = await api.connect(data.token, data.device_id ?? deviceId)
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
      const api = memoryApi()
      if (!api) throw new Error('Memory is not available in this build')
      const disconnectResult = await api.disconnect({ deleteCloud })
      if (deleteCloud) {
        // Finding 2 fix: supabase-js's functions.invoke() RESOLVES { data, error } instead
        // of throwing on a failed revoke (5xx, offline) — connect() above already does
        // `if (error) throw error` for the same client; disconnect() used to discard the
        // result entirely, so a failed revoke still reported a clean disconnect while
        // leaving the nmk_ token valid server-side forever.
        const { error } = await supabase.functions.invoke('memory-token', { body: { action: 'revoke', all: true } })
        if (error) throw error
      }
      await refresh()
      // Local disconnect still proceeds regardless of a cloud-delete failure (best-effort
      // semantics, unchanged) — only surface it so the UI can tell the user the cloud copy
      // may still exist. Set after refresh() so refresh's own setState (which never
      // touches `error`) can't clobber this.
      if (disconnectResult.cloudDeleteFailed) {
        setState((s) => ({ ...s, error: `Cloud data may not have been deleted: ${disconnectResult.cloudDeleteFailed}` }))
      }
    } catch (err) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }))
    }
  }, [refresh])

  return { ...state, connect, disconnect, refresh }
}
