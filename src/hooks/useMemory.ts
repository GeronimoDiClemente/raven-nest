import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

// Nest Memory Connect card state machine — docs/nest-memory-architecture.md §8.1.
// `migrating` covers both the connect-time import and the brief window before the first
// status poll resolves; it shows a single spinner, not per-source progress.
export type MemoryCardState =
  | 'unavailable'
  | 'disconnected'
  | 'connecting'
  | 'migrating'
  | 'connected'
  | 'paused'
  | 'error'
  // The token is valid but the account's plan doesn't include cloud sync — a
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
  /**
   * El código del motivo del estado actual del daemon ('offline', 'lock_held', ...), o
   * `null`. Un mismo estado puede tener motivos distintos y la copia cambia con el motivo.
   */
  statusDetail: string | null
  /** Lo que reporto el servidor. `null` mientras no reporto nada. */
  quota: { used_bytes: number; max_bytes: number } | null
  /** El tope de proyectos que informó el servidor. `null` mientras no informó. */
  limits: { max_projects: number } | null
  /** El roster de la nube (sin __global__), con nombres locales. `null` = el
   *  daemon todavía no recibió un status: la fila no se muestra. */
  cloudProjects: Array<{ projectKey: string; name: string }> | null
  /** Los repos que quedaron sólo en esta máquina por el tope (del doctor). */
  localOnlyProjects: Array<{ projectKey: string; name: string; count: number }>
  /** El proyecto elegido para seguir sincronizando, o null. */
  keptProjectKey: string | null
  /** Más proyectos en la nube que los que el plan sincroniza. */
  overLimit: boolean
}

/** Lo que MemoryAdoptionDialog necesita para preguntar. */
export interface PendingAdoption {
  userId: string
  count: number
  projects: string[]
}

/**
 * `window.memory` may not be exposed at all — not in a real build (preload.ts exposes it
 * unconditionally; the "memory is dead" signal there is `status().unavailable`, handled in
 * refresh()), but in tests and anywhere the renderer runs outside Electron. Assuming the
 * API is always there makes mounting `SettingsPanel` without it throw `Cannot read
 * properties of undefined (reading 'onStatus')`, taking down the whole tree containing it.
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
    statusDetail: null,
    quota: null,
    limits: null,
    cloudProjects: null,
    localOnlyProjects: [],
    keptProjectKey: null,
    overLimit: false,
  })
  // Guards refresh() from clobbering an in-flight connect()'s 'migrating' state with a
  // stale 'disconnected' read that a background status poll could otherwise race in.
  const connectingRef = useRef(false)
  // Sube con cada intento de connect. Un refresh que arrancó ANTES de un connect es viejo
  // aunque termine después de que el connect falló (connectingRef ya en false): sin esto
  // pisaría el 'error' del connect con el 'connected' que había leído antes. Con el doctor
  // en paralelo el status tarda un tick más, así que la carrera es real.
  // También sube cuando el connect TERMINA (éxito o falla): un refresh que arrancó DURANTE el
  // connect —main emite `memory:status` mientras conecta— captura la generación ya subida, y
  // si resuelve después de la falla pisaría el 'error' (p. ej. `not_in_beta`).
  const connectGenRef = useRef(0)

  const refresh = useCallback(async () => {
    const api = memoryApi()
    if (!api) return
    const gen = connectGenRef.current
    const [status, doc] = await Promise.all([
      api.status(),
      // Opcional (preload viejo) y con su propio catch: que el doctor falle no puede tapar el
      // estado de la nube.
      api.doctor?.().catch(() => null) ?? Promise.resolve(null),
    ])
    if (connectingRef.current || gen !== connectGenRef.current) return
    setState((s) => ({
      ...s,
      // `unavailable` MUST be checked first. The `!api` guard below only catches the
      // non-Electron/test case: `electron/preload.ts` calls exposeInMainWorld('memory', …)
      // unconditionally, with no knowledge of whether main's subsystem came up, so in a
      // real build `window.memory` always exists. main.ts's memory:status handler returns
      // `{ connected: false, daemonStatus: 'error', unavailable: true }` when the
      // subsystem is null. If `!status.connected` matched first, the card would render
      // 'disconnected' and SettingsPanel would tell a free user "Local memory active —
      // cloud sync is a Cloud feature" on a machine where memory is completely dead.
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
      // El motivo del estado. A diferencia de `quota`, acá NO se conserva el anterior: un
      // status sin detalle significa "este estado no tiene motivo", y arrastrar el viejo
      // dejaria a la UI explicando una pausa que ya se resolvio.
      statusDetail: status.daemonStatusDetail ?? null,
      // Se conserva la ultima conocida si esta respuesta no la trae: un status sin
      // cuota significa "no vino", no "el usuario se quedo sin nube".
      quota: status.quota ?? s.quota,
      // A diferencia de la cuota, NO se conserva: el daemon ya guarda el último tope conocido
      // de la cuenta y lo vacía al cambiar de cuenta. Conservarlo acá arrastraría el tope
      // de la cuenta anterior, y el tope decide si se ofrece Upgrade.
      limits: status.limits ?? null,
      // El roster NO se conserva: main lo manda siempre que el daemon lo tiene, y tras un cambio
      // de cuenta vuelve a undefined a propósito.
      cloudProjects: status.cloudProjects ?? null,
      localOnlyProjects: doc?.ok ? doc.localOnlyProjects ?? [] : [],
      // Como el roster: no se conservan, el daemon los vacía al cambiar de cuenta.
      keptProjectKey: status.keptProjectKey ?? null,
      overLimit: status.overLimit === true,
    }))
  }, [])

  // `_local` puede tener memorias sin dueño de antes de que existiera cuenta. En vez de
  // reclamarlas EN SILENCIO, se pregunta — MemoryAdoptionDialog se muestra cuando esto trae
  // algo, y el efecto de abajo se detiene hasta que resolveAdoption() conteste.
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
    // setUser(), sin preguntar.
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
      // Without this the card sits at 'disconnected', which is indistinguishable from
      // "all good, you just haven't connected" — with the subsystem down the UI would look
      // healthy.
      setState((s) => ({ ...s, state: 'unavailable' }))
      return
    }
    refresh()
    // Cada instancia saca sólo su oyente: removeStatusListener sordearía a las demás
    // (Settings y Memories montan useMemory a la vez). Queda para un preload viejo.
    const baja = api.onStatus(() => { void refresh() })
    return () => {
      if (typeof baja === 'function') baja()
      else api.removeStatusListener()
    }
  }, [refresh])

  /**
   * The single-account beta issues no credentials (spec §9.1) — the token is generated
   * with `openssl rand`, pasted here, and the service stores only its sha256.
   */
  const connectWithToken = useCallback(async (token: string) => {
    connectingRef.current = true
    connectGenRef.current++
    setState((s) => ({ ...s, state: 'connecting', error: null }))
    try {
      const api = memoryApi()
      if (!api) throw new Error('Memory is not available in this build')
      const deviceId = await api.ensureDeviceId()
      setState((s) => ({ ...s, state: 'migrating' }))
      const result = await api.connect(token.trim(), deviceId)
      if (!result.ok) throw new Error(result.error ?? 'Connect failed')
      connectingRef.current = false
      connectGenRef.current++
      await refresh()
    } catch (err) {
      connectingRef.current = false
      connectGenRef.current++
      setState((s) => ({ ...s, state: 'error', error: err instanceof Error ? err.message : String(err) }))
    }
  }, [refresh])

  /**
   * §9.2 — Connect contra el login, el camino del usuario final: el renderer saca el JWT de
   * la sesión de Supabase, main lo postea a `POST /v1/devices` del servicio de sync, y el
   * servicio devuelve el token del device una sola vez. `connectWithToken` sigue siendo el
   * camino del beta de una cuenta y el escape cuando el emisor está caído.
   */
  const connectWithLogin = useCallback(async () => {
    connectingRef.current = true
    connectGenRef.current++
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
      connectGenRef.current++
      await refresh()
    } catch (err) {
      connectingRef.current = false
      connectGenRef.current++
      setState((s) => ({ ...s, state: 'error', error: err instanceof Error ? err.message : String(err) }))
    }
  }, [refresh])

  const disconnect = useCallback(async (deleteCloud = false) => {
    try {
      // "Right to delete" — best-effort; local data is never touched by this.
      // Ordering matters: window.memory.disconnect() authenticates its delete-cloud-data
      // call with the locally stored nmk_ token, so it MUST run before that same token is
      // revoked. Revoking first makes the server reject the delete request with 401
      // revoked_token, silently leaving all cloud data intact.
      const api = memoryApi()
      if (!api) throw new Error('Memory is not available in this build')
      const disconnectResult = await api.disconnect({ deleteCloud })
      // El revoke no vive acá. Lo hace main contra `POST /v1/devices/revoke` del servicio,
      // en el mismo handler que borra la nube y que es el único que todavía tiene el token.
      // La edge function `memory-token` no sirve para esto: nunca se deployó a producción, y
      // el token quedaría válido en el servidor mientras el renderer reporta un revoke exitoso.
      await refresh()
      // Local disconnect still proceeds regardless of a cloud-delete failure (best-effort
      // semantics) — only surface it so the UI can tell the user the cloud copy
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

  /**
   * Elegir el proyecto que sigue sincronizando. Refresca pase lo que pase, y un IPC que
   * rechaza vuelve como `{ ok: false }`: la fila muestra el error.
   */
  const keepProject = useCallback(async (projectKey: string): Promise<{ ok: boolean; error?: string }> => {
    const api = memoryApi()
    if (!api?.keepProject) return { ok: false, error: 'This build cannot choose a project' }
    let r: { ok: boolean; error?: string }
    try {
      r = await api.keepProject(projectKey)
    } catch (err) {
      r = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    // Un status que falla no cambia lo que contestó el daemon.
    await refresh().catch(() => {})
    return r
  }, [refresh])

  return { ...state, connectWithToken, connectWithLogin, disconnect, refresh, pendingAdoption, resolveAdoption, keepProject }
}
