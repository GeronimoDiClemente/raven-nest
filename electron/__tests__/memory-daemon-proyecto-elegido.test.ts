// Spec 2b-2 §4.7/§4.8: el daemon guarda el proyecto elegido y si la cuenta está por encima del
// tope, y elige proyecto contra POST /v1/projects/keep.
import { describe, it, expect, vi } from 'vitest'
import { MemoryDaemon, MOTIVO_TOPE_DE_PROYECTOS } from '../memory-daemon'
import type { MemoryStore } from '../memory-store'

function fakeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    pendingMutations: vi.fn(() => []),
    markPushed: vi.fn(),
    blockMutations: vi.fn(),
    blockedMutations: vi.fn(() => []),
    unblockMutations: vi.fn(),
    listProjects: vi.fn(() => []),
    ensureProject: vi.fn(),
    teamIdForProjectKey: vi.fn(() => null),
    setLocalTeamId: vi.fn(),
    knownKeyEpoch: vi.fn(() => 0),
    rememberKeyEpoch: vi.fn(),
    ...overrides,
  } as unknown as MemoryStore
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const falla = (status: number, body: unknown) => ({ ok: false, status, json: async () => body })

function daemonCon(store: MemoryStore, fetchImpl: ReturnType<typeof vi.fn>): MemoryDaemon {
  return new MemoryDaemon({
    store,
    getSyncBaseUrl: () => 'https://example.test',
    getToken: () => 'nmk_test',
    getDeviceId: () => 'device-1',
    isOnline: () => true,
    fetchImpl,
  } as unknown as ConstructorParameters<typeof MemoryDaemon>[0])
}

describe('MemoryDaemon — proyecto elegido (2b-2 §4.7)', () => {
  it('guarda kept_project_key y over_limit; por defecto null y false', async () => {
    const daemon = daemonCon(fakeStore(), vi.fn().mockResolvedValue(ok({ plan: 'free', kept_project_key: 'k2', over_limit: true })))
    expect(daemon.getKeptProjectKey()).toBeNull()
    expect(daemon.isOverLimit()).toBe(false)
    await daemon.status()
    expect(daemon.getKeptProjectKey()).toBe('k2')
    expect(daemon.isOverLimit()).toBe(true)
  })

  it('un servicio viejo (sin los campos) no los cambia; null explícito sí', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok({ plan: 'free', kept_project_key: 'k2', over_limit: true }))
      .mockResolvedValueOnce(ok({ plan: 'free' }))
      .mockResolvedValueOnce(ok({ plan: 'free', kept_project_key: null, over_limit: false }))
    const daemon = daemonCon(fakeStore(), fetchImpl)
    await daemon.status()
    await daemon.status()
    expect(daemon.getKeptProjectKey()).toBe('k2')
    await daemon.status()
    expect(daemon.getKeptProjectKey()).toBeNull()
    expect(daemon.isOverLimit()).toBe(false)
  })

  it('cambiar de cuenta los vacía', async () => {
    const daemon = daemonCon(fakeStore(), vi.fn().mockResolvedValue(ok({ plan: 'free', kept_project_key: 'k2', over_limit: true })))
    await daemon.status()
    daemon.setStore(fakeStore())
    expect(daemon.getKeptProjectKey()).toBeNull()
    expect(daemon.isOverLimit()).toBe(false)
  })

  it('keepProject postea, devuelve a la cola lo retenido por el tope, pide status y agenda push', async () => {
    const store = fakeStore()
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok({ ok: true }))
      .mockResolvedValueOnce(ok({ plan: 'free', kept_project_key: 'k2', over_limit: true }))
    const daemon = daemonCon(store, fetchImpl)
    const push = vi.spyOn(daemon, 'scheduleMutationPush').mockImplementation(() => {})

    expect(await daemon.keepProject('k2')).toEqual({ ok: true })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://example.test/v1/projects/keep')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer nmk_test')
    expect(JSON.parse(String(init.body))).toEqual({ project_key: 'k2' })
    expect(store.unblockMutations).toHaveBeenCalledWith([MOTIVO_TOPE_DE_PROYECTOS])
    expect(fetchImpl.mock.calls[1][0]).toBe('https://example.test/v1/sync/status')
    expect(daemon.getKeptProjectKey()).toBe('k2')
    expect(push).toHaveBeenCalled()
  })

  it('keepProject con un rechazo devuelve el código y no toca la cola', async () => {
    const store = fakeStore()
    const daemon = daemonCon(store, vi.fn().mockResolvedValue(falla(409, { error: 'not_over_limit' })))
    expect(await daemon.keepProject('k2')).toEqual({ ok: false, error: 'not_over_limit' })
    expect(store.unblockMutations).not.toHaveBeenCalled()
  })

  it('keepProject sin conexión o con la red caída no lanza', async () => {
    const sinToken = new MemoryDaemon({
      store: fakeStore(), getSyncBaseUrl: () => 'https://example.test', getToken: () => null,
      getDeviceId: () => 'device-1', isOnline: () => true, fetchImpl: vi.fn(),
    } as unknown as ConstructorParameters<typeof MemoryDaemon>[0])
    expect(await sinToken.keepProject('k2')).toEqual({ ok: false, error: 'not_connected' })

    const caida = daemonCon(fakeStore(), vi.fn().mockRejectedValue(new Error('ECONNRESET')))
    expect(await caida.keepProject('k2')).toEqual({ ok: false, error: 'ECONNRESET' })
  })

  it('keepProject descarta la respuesta si la cuenta cambió mientras volaba (P6)', async () => {
    const viejo = fakeStore()
    let responder: (v: unknown) => void = () => {}
    const fetchImpl = vi.fn().mockImplementationOnce(() => new Promise((r) => { responder = r }))
    const daemon = daemonCon(viejo, fetchImpl)
    const push = vi.spyOn(daemon, 'scheduleMutationPush').mockImplementation(() => {})

    const enVuelo = daemon.keepProject('k2')
    const nuevo = fakeStore()
    daemon.setStore(nuevo)
    responder(ok({ ok: true }))

    expect(await enVuelo).toEqual({ ok: false, error: 'account_changed' })
    expect(viejo.unblockMutations).not.toHaveBeenCalled()
    expect(nuevo.unblockMutations).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(1) // sin status de la cuenta nueva
    expect(push).not.toHaveBeenCalled()
  })
})
