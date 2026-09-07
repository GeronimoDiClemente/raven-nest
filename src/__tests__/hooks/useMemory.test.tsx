import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useMemory } from '../../hooks/useMemory'

const supabaseMock = vi.hoisted(() => ({
  functions: { invoke: vi.fn() },
  // §9.2: connectWithLogin saca el JWT de la sesion. getUser: la cuenta de Nest duena
  // de las memorias.
  auth: { getSession: vi.fn(), getUser: vi.fn(), onAuthStateChange: vi.fn((_cb?: (evento: string, sesion: { user: { id: string } } | null) => void) => ({ data: { subscription: { unsubscribe: vi.fn() } } })) },
}))

vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

const memoryMock = {
  ensureDeviceId: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  status: vi.fn(),
  onStatus: vi.fn(),
  removeStatusListener: vi.fn(),
}

describe('useMemory disconnect', () => {
  const calls: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    calls.length = 0
    ;(globalThis as unknown as { window: Window }).window.memory = memoryMock as never

    memoryMock.status.mockResolvedValue({
      connected: true,
      deviceId: 'device-1',
      itemCount: 0,
      pendingCount: 0,
      daemonStatus: 'idle',
    })
    memoryMock.disconnect.mockImplementation(async () => {
      calls.push('disconnect')
      return { ok: true }
    })
    supabaseMock.functions.invoke.mockImplementation(async () => {
      calls.push('revoke')
      return { data: {}, error: null }
    })
  })

  // El revoke salio del renderer: lo hace main contra POST /v1/devices/revoke del servicio,
  // en el mismo handler que ya borra la nube y que es el unico que todavia tiene el token.
  // Antes esto llamaba a la edge function `memory-token`, la misma que C7 saco del camino de
  // Connect PORQUE NUNCA SE DEPLOYO: o sea que el token quedaba valido para siempre.
  it('no llama mas a la edge function: el revoke lo hace main contra el servicio', async () => {
    const { result } = renderHook(() => useMemory())

    await act(async () => {
      await result.current.disconnect(true)
    })

    expect(calls).toEqual(['disconnect'])
    expect(memoryMock.disconnect).toHaveBeenCalledWith({ deleteCloud: true })
    expect(supabaseMock.functions.invoke).not.toHaveBeenCalled()
  })

  it('surfacea tokenRevokeFailed, que es lo que deja una credencial viva en el servidor', async () => {
    memoryMock.disconnect.mockImplementation(async () => {
      calls.push('disconnect')
      return { ok: true, tokenRevokeFailed: 'HTTP 503' }
    })
    const { result } = renderHook(() => useMemory())

    await act(async () => {
      await result.current.disconnect(false)
    })

    await waitFor(() => expect(result.current.error).toBe('This device\u2019s sync token may still be valid on the server: HTTP 503'))
  })

  it('does not revoke tokens when deleteCloud is false', async () => {
    const { result } = renderHook(() => useMemory())

    await act(async () => {
      await result.current.disconnect(false)
    })

    expect(calls).toEqual(['disconnect'])
    expect(supabaseMock.functions.invoke).not.toHaveBeenCalled()
  })

  it('surfaces an error and does not crash if window.memory.disconnect rejects', async () => {
    memoryMock.disconnect.mockRejectedValueOnce(new Error('ipc down'))
    const { result } = renderHook(() => useMemory())

    await act(async () => {
      await result.current.disconnect(true)
    })

    await waitFor(() => expect(result.current.error).toBe('ipc down'))
    expect(supabaseMock.functions.invoke).not.toHaveBeenCalled()
  })

  // Finding 2 fix: supabase-js's functions.invoke() resolves { data, error } instead of
  // throwing on a failed revoke — the old code discarded this result, so a 5xx/offline
  // revoke still reported a clean disconnect and left the nmk_ token valid server-side.


  // Finding 2 fix: main.ts's memory:disconnect handler now reports a failed
  // delete-cloud-data call via `cloudDeleteFailed` instead of swallowing it — the hook
  // must surface that into its error state so the UI can tell the user cloud data may
  // still exist, while still treating the (local) disconnect itself as successful.
  it('surfaces cloudDeleteFailed from window.memory.disconnect as an error, without failing the disconnect', async () => {
    memoryMock.disconnect.mockImplementation(async () => {
      calls.push('disconnect')
      return { ok: true, cloudDeleteFailed: 'HTTP 500' }
    })
    const { result } = renderHook(() => useMemory())

    await act(async () => {
      await result.current.disconnect(true)
    })

    await waitFor(() => expect(result.current.error).toBe('Cloud data may not have been deleted: HTTP 500'))
    expect(calls).toEqual(['disconnect'])
  })
})

describe('useMemory — unavailable and hand-pasted token (C7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Assign undefined rather than `delete`: the property is non-optional on the Window
    // type, and `delete` on it is a TS2790 error under tsconfig.web.json.
    ;(globalThis as unknown as { window: { memory?: unknown } }).window.memory = undefined
  })

  it('reports unavailable when window.memory is missing entirely (non-Electron / test case)', async () => {
    const { result } = renderHook(() => useMemory())
    await waitFor(() => expect(result.current.state).toBe('unavailable'))
  })

  // The shape production actually produces: preload.ts exposes `window.memory`
  // unconditionally, so the API is always there and main reports the dead subsystem via
  // `unavailable: true` on a status() that is ALSO `connected: false`. Before this fix
  // `!status.connected` matched first and the card showed 'disconnected', which
  // SettingsPanel renders for a free user as "Local memory active".
  it('reports unavailable when status() flags it, even though window.memory exists and reports disconnected', async () => {
    ;(globalThis as unknown as { window: Window }).window.memory = memoryMock as never
    memoryMock.status.mockResolvedValue({
      connected: false,
      deviceId: null,
      itemCount: 0,
      pendingCount: 0,
      daemonStatus: 'error',
      unavailable: true,
    })

    const { result } = renderHook(() => useMemory())
    await waitFor(() => expect(result.current.state).toBe('unavailable'))
  })

  it('connects with a hand-pasted token and trims its whitespace', async () => {
    ;(globalThis as unknown as { window: Window }).window.memory = memoryMock as never
    memoryMock.ensureDeviceId.mockResolvedValue('dev-1')
    memoryMock.connect.mockResolvedValue({ ok: true })
    memoryMock.status.mockResolvedValue({
      connected: true, deviceId: 'dev-1', itemCount: 3, pendingCount: 0, daemonStatus: 'idle',
    })

    const { result } = renderHook(() => useMemory())
    await act(async () => { await result.current.connectWithToken('  nmk_pegado_a_mano  ') })

    expect(memoryMock.connect).toHaveBeenCalledWith('nmk_pegado_a_mano', 'dev-1')
    await waitFor(() => expect(result.current.state).toBe('connected'))
  })

  it('never calls the memory-token edge function', async () => {
    ;(globalThis as unknown as { window: Window }).window.memory = memoryMock as never
    memoryMock.ensureDeviceId.mockResolvedValue('dev-1')
    memoryMock.connect.mockResolvedValue({ ok: true })
    memoryMock.status.mockResolvedValue({
      connected: true, deviceId: 'dev-1', itemCount: 0, pendingCount: 0, daemonStatus: 'idle',
    })

    const { result } = renderHook(() => useMemory())
    await act(async () => { await result.current.connectWithToken('nmk_x') })

    expect(supabaseMock.functions.invoke).not.toHaveBeenCalled()
  })

  // smoke/memory-bridge task: a 403 plan_required from the server surfaces through the
  // daemon as daemonStatus: 'plan_required' (electron/memory-daemon.ts), which must map
  // to its own MemoryCardState — not 'error' — so SettingsPanel can show the Upgrade
  // button instead of "Couldn't sync".
  it('maps daemonStatus "plan_required" to its own state, distinct from "error"', async () => {
    ;(globalThis as unknown as { window: Window }).window.memory = memoryMock as never
    memoryMock.status.mockResolvedValue({
      connected: true, deviceId: 'dev-1', itemCount: 5, pendingCount: 2, daemonStatus: 'plan_required',
    })

    const { result } = renderHook(() => useMemory())
    await waitFor(() => expect(result.current.state).toBe('plan_required'))
  })

  it('leaves the state in error when connect resolves ok:false', async () => {
    ;(globalThis as unknown as { window: Window }).window.memory = memoryMock as never
    memoryMock.ensureDeviceId.mockResolvedValue('dev-1')
    memoryMock.connect.mockResolvedValue({ ok: false, error: 'invalid token' })
    memoryMock.status.mockResolvedValue({
      connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle',
    })

    const { result } = renderHook(() => useMemory())
    await act(async () => { await result.current.connectWithToken('nmk_malo') })

    expect(result.current.state).toBe('error')
    expect(result.current.error).toBe('invalid token')
  })
})

// §9.2 — Connect contra el login, que es lo que reemplaza al token pegado a mano de C7.
// El renderer tiene el JWT de Supabase; main lo postea a `POST /v1/devices` del servicio,
// que verifica la firma y devuelve el token del device UNA sola vez. El token vuelve por el
// mismo camino que el pegado a mano (`api.connect`), así que no hay exposición nueva.
describe('useMemory — connect contra el login (§9.2)', () => {
  const memoriaConRegistro = {
    ...memoryMock,
    registerDevice: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as unknown as { window: Window }).window.memory = memoriaConRegistro as never
    memoryMock.status.mockResolvedValue({
      connected: true, deviceId: 'dev-1', itemCount: 0, pendingCount: 0, daemonStatus: 'idle',
    })
    memoryMock.connect.mockResolvedValue({ ok: true })
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-de-login' } } })
  })

  it('manda el JWT del login y conecta con el token que devuelve el servicio', async () => {
    memoriaConRegistro.registerDevice.mockResolvedValue({ ok: true, deviceId: 'dev-9', token: 'nmk_del_servicio' })
    const { result } = renderHook(() => useMemory())

    await act(async () => { await result.current.connectWithLogin() })

    expect(memoriaConRegistro.registerDevice).toHaveBeenCalledWith('jwt-de-login')
    expect(memoryMock.connect).toHaveBeenCalledWith('nmk_del_servicio', 'dev-9')
  })

  it('sin sesion no llama al servicio: pedir un token sin login no tiene sentido', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } })
    const { result } = renderHook(() => useMemory())

    await act(async () => { await result.current.connectWithLogin() })

    expect(memoriaConRegistro.registerDevice).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.state).toBe('error'))
  })

  it('surfacea el error del servicio en vez de dejar la card en connecting para siempre', async () => {
    memoriaConRegistro.registerDevice.mockResolvedValue({ ok: false, error: 'not_in_beta' })
    const { result } = renderHook(() => useMemory())

    await act(async () => { await result.current.connectWithLogin() })

    await waitFor(() => expect(result.current.error).toBe('not_in_beta'))
    expect(result.current.state).toBe('error')
    expect(memoryMock.connect).not.toHaveBeenCalled()
  })
})

// Las memorias son de la CUENTA DE NEST. El store vive en la máquina, así que alguien tiene
// que decirle cuál es la cuenta activa: lo hace el renderer, que es donde está la sesión de
// Supabase. Sin esto el store no sella el autor y el push no puede acotarse a nadie.
describe('useMemory — le dice al store de quien son las memorias', () => {
  const memoriaConUser = { ...memoryMock, setUser: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as unknown as { window: Window }).window.memory = memoriaConUser as never
    memoryMock.status.mockResolvedValue({
      connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle',
    })
    supabaseMock.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  })

  it('al montar le pasa la cuenta logueada', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-aaaa' } } })

    renderHook(() => useMemory())

    await waitFor(() => expect(memoriaConUser.setUser).toHaveBeenCalledWith('user-aaaa'))
  })

  it('sin sesion le pasa null, en vez de dejar el store sin dueno declarado', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })

    renderHook(() => useMemory())

    await waitFor(() => expect(memoriaConUser.setUser).toHaveBeenCalledWith(null))
  })

  it('se entera de un cambio de cuenta sin reiniciar la app', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-aaaa' } } })
    let notificar: ((evento: string, sesion: { user: { id: string } } | null) => void) | undefined
    supabaseMock.auth.onAuthStateChange.mockImplementation((cb) => {
      notificar = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })

    renderHook(() => useMemory())
    await waitFor(() => expect(memoriaConUser.setUser).toHaveBeenCalledWith('user-aaaa'))

    await act(async () => { notificar?.('SIGNED_IN', { user: { id: 'user-bbbb' } }) })

    expect(memoriaConUser.setUser).toHaveBeenCalledWith('user-bbbb')
  })
})

// Task 2 (adopción con aviso): antes de adoptar en silencio lo que haya en `_local`, se
// pregunta. `checkPendingAdoption` es lo que decide si corresponde preguntar.
describe('useMemory — adopción con aviso (Task 2)', () => {
  const memoriaConAdopcion = { ...memoryMock, setUser: vi.fn(), checkPendingAdoption: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as unknown as { window: Window }).window.memory = memoriaConAdopcion as never
    memoryMock.status.mockResolvedValue({
      connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle',
    })
    supabaseMock.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  })

  it('sin nada pendiente, llama setUser directo — no bloquea el login por las dudas', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-aaaa' } } })
    memoriaConAdopcion.checkPendingAdoption.mockResolvedValue({ hasPending: false, count: 0, projects: [] })

    const { result } = renderHook(() => useMemory())

    await waitFor(() => expect(memoriaConAdopcion.setUser).toHaveBeenCalledWith('user-aaaa'))
    expect(result.current.pendingAdoption).toBeNull()
  })

  it('con datos pendientes, NO llama setUser todavia — expone pendingAdoption para el dialogo', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-aaaa' } } })
    memoriaConAdopcion.checkPendingAdoption.mockResolvedValue({ hasPending: true, count: 7, projects: ['Alfa', 'Zeta'] })

    const { result } = renderHook(() => useMemory())

    await waitFor(() => expect(result.current.pendingAdoption).toEqual({ userId: 'user-aaaa', count: 7, projects: ['Alfa', 'Zeta'] }))
    expect(memoriaConAdopcion.setUser).not.toHaveBeenCalled()
  })

  it('resolveAdoption(true): llama setUser sin adopt:false y limpia pendingAdoption', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-aaaa' } } })
    memoriaConAdopcion.checkPendingAdoption.mockResolvedValue({ hasPending: true, count: 3, projects: ['Alfa'] })

    const { result } = renderHook(() => useMemory())
    await waitFor(() => expect(result.current.pendingAdoption).not.toBeNull())

    await act(async () => { await result.current.resolveAdoption(true) })

    expect(memoriaConAdopcion.setUser).toHaveBeenCalledWith('user-aaaa', undefined)
    expect(result.current.pendingAdoption).toBeNull()
  })

  it('resolveAdoption(false): llama setUser con adopt:false — nada se pierde, solo no se reclama', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-aaaa' } } })
    memoriaConAdopcion.checkPendingAdoption.mockResolvedValue({ hasPending: true, count: 3, projects: ['Alfa'] })

    const { result } = renderHook(() => useMemory())
    await waitFor(() => expect(result.current.pendingAdoption).not.toBeNull())

    await act(async () => { await result.current.resolveAdoption(false) })

    expect(memoriaConAdopcion.setUser).toHaveBeenCalledWith('user-aaaa', { adopt: false })
    expect(result.current.pendingAdoption).toBeNull()
  })

  it('logout (userId null) nunca pregunta: no hay nada que adoptar al salir', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })

    renderHook(() => useMemory())

    await waitFor(() => expect(memoriaConAdopcion.setUser).toHaveBeenCalledWith(null))
    expect(memoriaConAdopcion.checkPendingAdoption).not.toHaveBeenCalled()
  })

  it('preload viejo sin checkPendingAdoption: cae directo a setUser, como antes de la Task 2', async () => {
    const memoriaVieja = { ...memoryMock, setUser: vi.fn() } // sin checkPendingAdoption
    ;(globalThis as unknown as { window: Window }).window.memory = memoriaVieja as never
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-aaaa' } } })

    renderHook(() => useMemory())

    await waitFor(() => expect(memoriaVieja.setUser).toHaveBeenCalledWith('user-aaaa'))
  })
})
