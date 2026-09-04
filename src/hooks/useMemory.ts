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

/** Task 2 (adopción con aviso): lo que MemoryAdoptionDialog necesita para preguntar. */
export interface PendingAdoption {
  userId: string
  count: number
  projects: string[]
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
      // user "Local memory active — cloud sync is a Cloud feature" on a machine where
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

  // Task 2 (adopción con aviso): `_local` puede tener memorias sin dueño de antes de que
  // existiera cuenta. Antes de reclamarlas EN SILENCIO (el comportamiento de la Task 1),
  // se pregunta — MemoryAdoptionDialog se muestra cuando esto trae algo, y el efecto de
  // abajo se detiene hasta que resolveAdoption() conteste.
  const [pendingAdoption, setPendingAdoption] = useState<PendingAdoption | null>(null)

  const applyUser = useCallback(async (userId: string | null) => {
    const api = memoryApi()
    if (!api?.setUser) return
    if (!userId) {
      // Logout no tiene nada que adoptar — directo, como siempre.
      void api.setUser(userId)
      return
    }
    // `checkPendingAdoption` es opcional (preload viejo): si no está, cae directo a
    // setUser(), igual que se comportaba antes de la Task 2.
    const pending = await api.checkPendingAdoption?.(userId)
    if (pending?.hasPending) {
      setPendingAdoption({ userId, count: pending.count, projects: pending.projects })
      return
    }
    void api.setUser(userId)
  }, [])

  /** La respuesta de MemoryAdoptionDialog. `adopt=false` no borra nada — ver swapMemoryStore. */
  const resolveAdoption = useCallback(async (adopt: boolean) => {
    const api = memoryApi()
    const pending = pendingAdoption
    if (!api?.setUser || !pending) return
    setPendingAdoption(null)
    await api.setUser(pending.userId, adopt ? undefined : { adopt: false })
  }, [pendingAdoption])

  // Las memorias son de la CUENTA DE NEST, no de la máquina ni de la IA. El store vive en
  // la máquina (una sola base bajo `{home}/.raven-nest/memory/`), así que alguien tiene que
  // decirle cuál es la cuenta activa: el renderer, que es donde está la sesión. Con eso el
  // store sella el autor de cada escritura y el daemon empuja sólo lo de esa cuenta.
  //
  // Efecto propio, separado del de status: no depende de `refresh` y tiene que correr
  // aunque la memoria esté desconectada, porque la captura local pasa igual.
  useEffect(() => {
    const api = memoryApi()
    if (!api?.setUser) return
    let vivo = true

    void supabase.auth.getUser().then(({ data }) => {
      if (vivo) void applyUser(data.user?.id ?? null)
    })

    const { data } = supabase.auth.onAuthStateChange((_evento, sesion) => {
      void applyUser(sesion?.user?.id ?? null)
    })
    return () => {
      vivo = false
      data?.subscription?.unsubscribe()
    }
  }, [applyUser])


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

  /**
   * §9.2 — Connect contra el login. Reemplaza al token pegado a mano de C7 para el usuario
   * final: el renderer saca el JWT de la sesión de Supabase, main lo postea a
   * `POST /v1/devices` del servicio de sync, y el servicio devuelve el token del device una
   * sola vez. `connectWithToken` se queda igual: sigue siendo el camino del beta de una
   * cuenta y el escape cuando el emisor está caído.
   */
  const connectWithLogin = useCallback(async () => {
    connectingRef.current = true
    setState((s) => ({ ...s, state: 'connecting', error: null }))
    try {
      const api = memoryApi()
      if (!api) throw new Error('Memory is not available in this build')
      if (!api.registerDevice) throw new Error('This build cannot request a token — paste one instead')

      const { data } = await supabase.auth.getSession()
      const jwt = data.session?.access_token
      // Sin sesión no hay identidad que el servicio pueda verificar: pedirle un token sería
      // un 401 garantizado, y el usuario leería "tus credenciales no sirven" cuando lo que
      // pasa es que no está logueado.
      if (!jwt) throw new Error('Sign in first — the service issues the token against your login')

      setState((s) => ({ ...s, state: 'migrating' }))
      const emitido = await api.registerDevice(jwt)
      if (!emitido.ok) throw new Error(emitido.error ?? 'Could not register this device')

      const result = await api.connect(emitido.token, emitido.deviceId)
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
      // El revoke ya no vive acá. Lo hace main contra `POST /v1/devices/revoke` del servicio,
      // en el mismo handler que borra la nube y que es el único que todavía tiene el token.
      // Antes esto llamaba a la edge function `memory-token` — la misma que C7 sacó del
      // camino de Connect PORQUE NUNCA SE DEPLOYÓ a producción. O sea que el token seguía
      // valido en el servidor para siempre, y el renderer reportaba un revoke exitoso.
      await refresh()
      // Local disconnect still proceeds regardless of a cloud-delete failure (best-effort
      // semantics, unchanged) — only surface it so the UI can tell the user the cloud copy
      // may still exist. Set after refresh() so refresh's own setState (which never
      // touches `error`) can't clobber this.
      if (disconnectResult.cloudDeleteFailed) {
        setState((s) => ({ ...s, error: `Cloud data may not have been deleted: ${disconnectResult.cloudDeleteFailed}` }))
      } else if (disconnectResult.tokenRevokeFailed) {
        // Menos ruidoso que el borrado fallido, pero es lo que deja una credencial viva en
        // el servidor: si el usuario se desconectó porque perdió la máquina, importa.
        setState((s) => ({ ...s, error: `This device\u2019s sync token may still be valid on the server: ${disconnectResult.tokenRevokeFailed}` }))
      }
    } catch (err) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }))
    }
  }, [refresh])

  return { ...state, connectWithToken, connectWithLogin, disconnect, refresh, pendingAdoption, resolveAdoption }
}
