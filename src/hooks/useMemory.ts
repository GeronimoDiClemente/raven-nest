import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

// Nest Memory Connect card state machine — docs/nest-memory-architecture.md §8.1.
// `migrating` covers both the connect-time import (§5.4) and the brief window before the
// first status poll resolves; Phase 1 shows a single spinner rather than the full
// per-source checklist UI (§5.4's line-by-line progress), which is a Phase 3 dashboard
// refinement, not a Phase 1 acceptance requirement.
export type MemoryCardState =
  | 'unavailable'
  | 'disconnected'
  | 'connecting'
  | 'migrating'
  | 'connected'
  | 'paused'
  | 'error'
  // spec §9.3: the token is valid but the account's plan doesn't include cloud sync — a
  // 403 plan_required, not a credential problem. Distinct from 'error' so SettingsPanel
  // can hang an Upgrade affordance off it (reusing the existing free-plan Upgrade button
  // path, see setMemoryUpgradeOpen) instead of showing a generic "couldn't sync" message.
  | 'plan_required'

interface MemoryHookState {
  state: MemoryCardState
  itemCount: number
  pendingCount: number
  deviceId: string | null
  error: string | null
  /** Lo que reporto el servidor. `null` mientras no reporto nada. */
  quota: { used_bytes: number; max_bytes: number } | null
}

/**
 * `window.memory` may not be exposed at all — not in a real build (preload.ts exposes it
 * unconditionally; the "memory is dead" signal there is `status().unavailable`, handled in
 * refresh()), but in tests and anywhere the renderer runs outside Electron. This hook was
 * the only piece that assumed the API is always there, so mounting `SettingsPanel` without
 * it threw `Cannot read properties of undefined (reading 'onStatus')` and took down the
 * whole tree containing it. That is bug 3.4 in docs/MEMORY_INTEGRATIONS_CONTRACT.md: it
 * only shows up when this branch meets the integrations branch, because neither one mounts
 * the panel without the API on its own.
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
    quota: null,
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
      // `unavailable` MUST be checked first. The `!api` guard below only catches the
      // non-Electron/test case: `electron/preload.ts` calls exposeInMainWorld('memory', …)
      // unconditionally, with no knowledge of whether main's subsystem came up, so in a
      // real build `window.memory` always exists. main.ts's memory:status handler returns
      // `{ connected: false, daemonStatus: 'error', unavailable: true }` when the
      // subsystem is null, and this hook used to discard that flag: `!status.connected`
      // matched first, the card rendered 'disconnected', and SettingsPanel told a free
      // user "Local memory active — cloud sync is a Pro feature" on a machine where
      // memory was completely dead.
      state: status.unavailable
        ? 'unavailable'
        : !status.connected
          ? 'disconnected'
          : status.daemonStatus === 'plan_required'
            ? 'plan_required'
            : status.daemonStatus === 'paused'
              ? 'paused'
              : status.daemonStatus === 'error'
                ? 'error'
                : 'connected',
      itemCount: status.itemCount,
      pendingCount: status.pendingCount,
      deviceId: status.deviceId,
      // Se conserva la ultima conocida si esta respuesta no la trae: un status sin
      // cuota significa "no vino", no "el usuario se quedo sin nube".
      quota: status.quota ?? s.quota,
    }))
  }, [])

  useEffect(() => {
    const api = memoryApi()
    if (!api) {
      // C7: without this the card sits at 'disconnected', which is indistinguishable from
      // "all good, you just haven't connected" — with the subsystem down the UI disguised
      // itself as healthy.
      setState((s) => ({ ...s, state: 'unavailable' }))
      return
    }
    refresh()
    api.onStatus(() => { void refresh() })
    return () => api.removeStatusListener()
  }, [refresh])

  /**
   * C7: the single-account beta issues no credentials (spec §9.1) — the token is generated
   * with `openssl rand`, pasted here, and the service stores only its sha256. This replaces
   * the previous `supabase.functions.invoke('memory-token')`, which additionally called an
   * edge function that was never deployed to production: pressing Connect returned a 404
   * dressed up as "Couldn't sync".
   */
  const connectWithToken = useCallback(async (token: string) => {
    connectingRef.current = true
    setState((s) => ({ ...s, state: 'connecting', error: null }))
    try {
      const api = memoryApi()
      if (!api) throw new Error('Memory is not available in this build')
      const deviceId = await api.ensureDeviceId()
      setState((s) => ({ ...s, state: 'migrating' }))
      const result = await api.connect(token.trim(), deviceId)
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

  return { ...state, connectWithToken, disconnect, refresh }
}
