// Spec 2b-1 §4.2/§4.6: el daemon guarda el tope de proyectos y el roster que informa el
// servidor, y un cambio de plan devuelve a la cola lo retenido por el tope.
import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'
import { MemoryDaemon } from '../memory-daemon'
import { MemoryStore } from '../memory-store'
import { makeTmpDir, cleanupTmp } from './setup'

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

describe('MemoryDaemon — el tope de proyectos (2b-1 §4.2)', () => {
  it('guarda limits.max_projects y lo expone; null mientras no hubo status', async () => {
    const daemon = daemonCon(fakeStore(), vi.fn().mockResolvedValue(ok({ plan: 'free', limits: { max_projects: 1 } })))
    expect(daemon.getLimits()).toBeNull()
    await daemon.status()
    expect(daemon.getLimits()).toEqual({ max_projects: 1 })
  })

  it('un status sin limits (servicio viejo) conserva el último conocido', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok({ plan: 'free', limits: { max_projects: 1 } }))
      .mockResolvedValueOnce(ok({ plan: 'free' }))
    const daemon = daemonCon(fakeStore(), fetchImpl)
    await daemon.status()
    await daemon.status()
    expect(daemon.getLimits()).toEqual({ max_projects: 1 })
  })

  it('un limits roto se ignora', async () => {
    const daemon = daemonCon(fakeStore(), vi.fn().mockResolvedValue(ok({ plan: 'free', limits: { max_projects: '1' } })))
    await daemon.status()
    expect(daemon.getLimits()).toBeNull()
  })

  it('guarda las keys del roster, sin __global__ ni keys vacías', async () => {
    const daemon = daemonCon(fakeStore(), vi.fn().mockResolvedValue(ok({
      plan: 'free',
      projects: [{ project_key: 'k1', display_name: 'nmc1:xyz' }, { project_key: '__global__' }, { project_key: '' }],
    })))
    expect(daemon.getCloudProjectKeys()).toBeNull()
    await daemon.status()
    expect(daemon.getCloudProjectKeys()).toEqual(['k1'])
  })

  it('cambiar de cuenta vacía tope y roster (Review Focus 1)', async () => {
    const daemon = daemonCon(fakeStore(), vi.fn().mockResolvedValue(ok({
      plan: 'free', limits: { max_projects: 1 }, projects: [{ project_key: 'k1' }],
    })))
    await daemon.status()
    daemon.setStore(fakeStore())
    expect(daemon.getLimits()).toBeNull()
    expect(daemon.getCloudProjectKeys()).toBeNull()
  })

  it('un status en vuelo de la cuenta anterior no vuelve a llenarlos después del cambio', async () => {
    let responder!: (v: unknown) => void
    const fetchImpl = vi.fn(() => new Promise((resolve) => { responder = resolve }))
    const daemon = daemonCon(fakeStore(), fetchImpl)
    const enVuelo = daemon.status()
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    daemon.setStore(fakeStore())
    responder(ok({ plan: 'free', limits: { max_projects: 1 }, projects: [{ project_key: 'k1' }] }))
    await enVuelo
    expect(daemon.getLimits()).toBeNull()
    expect(daemon.getCloudProjectKeys()).toBeNull()
  })
})

describe('MemoryDaemon — al pasar a Cloud, lo retenido por el tope vuelve a la cola (2b-1 §4.6)', () => {
  it('con plan cloud en el status siguiente, la mutación retenida vuelve a pendingMutations', async () => {
    const dir = makeTmpDir('md-tope-')
    const store = new MemoryStore(join(dir, 'memory.db'))
    try {
      store.save({ projectKey: 'k-web', type: 'decision', title: 'web', content: 'retained by the project cap', source: 'mcp' })
      const [m] = store.pendingMutations()
      store.blockMutations([{ seq: m.seq, reason: 'project_limit_reached' }])
      expect(store.pendingMutations()).toHaveLength(0)

      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(ok({ plan: 'free', limits: { max_projects: 1 } }))
        .mockResolvedValueOnce(ok({ plan: 'cloud', limits: { max_projects: 100 } }))
      const daemon = daemonCon(store, fetchImpl)

      await daemon.status() // el primero sólo fija el plan: nada que destrabar
      expect(store.pendingMutations()).toHaveLength(0)

      await daemon.status() // free -> cloud
      expect(store.pendingMutations().map((x) => x.seq)).toEqual([m.seq])
      expect(store.proyectosRetenidosPor('project_limit_reached')).toEqual([])
      expect(daemon.getLimits()).toEqual({ max_projects: 100 })
    } finally {
      store.close()
      cleanupTmp(dir)
    }
  })
})
