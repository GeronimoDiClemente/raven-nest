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

/**
 * Final review #1 (Ruling 5): el destrabe no puede depender de VER el cambio de plan en el
 * mismo proceso. Con el tope que informa el servidor, "hay lugar" alcanza: converge solo
 * después de un reinicio (daemon nuevo) o de un cambio de cuenta.
 */
describe('MemoryDaemon — lo retenido por el tope vuelve a la cola cuando hay lugar', () => {
  function conRetenida(fn: (store: MemoryStore, seq: number) => Promise<void>) {
    return async () => {
      const dir = makeTmpDir('md-tope-lugar-')
      const store = new MemoryStore(join(dir, 'memory.db'))
      try {
        store.save({ projectKey: 'k-web', type: 'decision', title: 'web', content: 'retained by the project cap', source: 'mcp' })
        const [m] = store.pendingMutations()
        store.blockMutations([{ seq: m.seq, reason: 'project_limit_reached' }])
        expect(store.pendingMutations()).toHaveLength(0)
        await fn(store, m.seq)
      } finally {
        store.close()
        cleanupTmp(dir)
      }
    }
  }

  it('Free→Cloud visto sólo después de un reinicio: el primer status ya es cloud y la libera', conRetenida(async (store, seq) => {
    const daemon = daemonCon(store, vi.fn().mockResolvedValue(ok({
      plan: 'cloud', limits: { max_projects: 100 }, projects: [{ project_key: 'k-nest' }],
    })))
    await daemon.status()
    expect(store.pendingMutations().map((x) => x.seq)).toEqual([seq])
  }))

  it('con el roster en el tope, sigue retenida', conRetenida(async (store) => {
    const daemon = daemonCon(store, vi.fn().mockResolvedValue(ok({
      plan: 'free', limits: { max_projects: 1 }, projects: [{ project_key: 'k-nest' }, { project_key: '__global__' }],
    })))
    await daemon.status()
    expect(store.pendingMutations()).toHaveLength(0)
  }))

  it('sin tope conocido (servicio viejo) no destraba por lugar', conRetenida(async (store) => {
    const daemon = daemonCon(store, vi.fn().mockResolvedValue(ok({ plan: 'free', projects: [] })))
    await daemon.status()
    expect(store.pendingMutations()).toHaveLength(0)
  }))

  it('cambio de cuenta a una que ya es Cloud: el primer status de la cuenta nueva la libera', conRetenida(async (store, seq) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok({ plan: 'free', limits: { max_projects: 1 }, projects: [{ project_key: 'k-otro' }] }))
      .mockResolvedValueOnce(ok({ plan: 'cloud', limits: { max_projects: 100 }, projects: [] }))
    const otra = fakeStore()
    const daemon = daemonCon(otra, fetchImpl)
    await daemon.status() // cuenta A, Free en el tope
    daemon.setStore(store) // cuenta B
    expect(daemon.getPlan()).toBeUndefined()
    await daemon.status()
    expect(store.pendingMutations().map((x) => x.seq)).toEqual([seq])
  }))
})

/**
 * Final review #3 (Ruling 6): en el drain del connect el status corre ANTES del push, así que
 * el roster llega vacío. Un push que cambia el roster (acepta un proyecto nuevo o recibe
 * `project_limit_reached`) pide un status enseguida — y sólo ese push, no todos.
 */
describe('MemoryDaemon — el push que cambia el roster pide un status', () => {
  function servidor() {
    const roster: string[] = []
    const fetchImpl = vi.fn(async (url: string, init?: { body?: string }) => {
      if (url.endsWith('/v1/sync/status')) {
        return ok({ plan: 'free', limits: { max_projects: 1 }, projects: roster.map((k) => ({ project_key: k })) })
      }
      const body = JSON.parse(init?.body ?? '{}') as { mutations: Array<{ sync_id: string; payload: { project_key?: string } }> }
      const results = body.mutations.map((m) => {
        const k = m.payload.project_key ?? '__global__'
        if (k === '__global__' || roster.includes(k)) return { sync_id: m.sync_id, outcome: 'applied' }
        if (roster.length < 1) { roster.push(k); return { sync_id: m.sync_id, outcome: 'applied' } }
        return { sync_id: m.sync_id, outcome: 'rejected', error: 'project_limit_reached' }
      })
      return ok({ results })
    })
    const llamadasDeStatus = () => fetchImpl.mock.calls.filter(([u]) => String(u).endsWith('/v1/sync/status')).length
    return { fetchImpl, llamadasDeStatus }
  }

  it('Free con 2 repos: después del push el roster ya tiene el proyecto aceptado', async () => {
    const dir = makeTmpDir('md-tope-push-')
    const store = new MemoryStore(join(dir, 'memory.db'))
    try {
      store.save({ projectKey: 'k-nest', type: 'decision', title: 'nest', content: 'goes to the cloud', source: 'mcp' })
      store.save({ projectKey: 'k-api', type: 'decision', title: 'api', content: 'stays local', source: 'mcp' })
      const { fetchImpl, llamadasDeStatus } = servidor()
      const daemon = daemonCon(store, fetchImpl)
      await daemon.status() // el del drain del connect: roster vacío
      expect(daemon.getCloudProjectKeys()).toEqual([])
      await daemon.push()
      await vi.waitFor(() => expect(daemon.getCloudProjectKeys()).toEqual(['k-nest']))
      expect(llamadasDeStatus()).toBe(2)
      expect(store.proyectosRetenidosPor('project_limit_reached').map((p) => p.projectKey)).toEqual(['k-api'])

      // Un push más de un proyecto que ya está en el roster no pide otro status.
      store.save({ projectKey: 'k-nest', type: 'decision', title: 'nest 2', content: 'same project', source: 'mcp' })
      await daemon.push()
      await new Promise((r) => setImmediate(r))
      expect(llamadasDeStatus()).toBe(2)
    } finally {
      store.close()
      cleanupTmp(dir)
    }
  })

  it('un rechazo con el roster ya en el tope no pide status', async () => {
    const dir = makeTmpDir('md-tope-push2-')
    const store = new MemoryStore(join(dir, 'memory.db'))
    try {
      store.save({ projectKey: 'k-nest', type: 'decision', title: 'nest', content: 'goes to the cloud', source: 'mcp' })
      const { fetchImpl, llamadasDeStatus } = servidor()
      const daemon = daemonCon(store, fetchImpl)
      await daemon.status()
      await daemon.push()
      await vi.waitFor(() => expect(daemon.getCloudProjectKeys()).toEqual(['k-nest']))
      const antes = llamadasDeStatus()
      store.save({ projectKey: 'k-api', type: 'decision', title: 'api', content: 'stays local', source: 'mcp' })
      await daemon.push()
      await new Promise((r) => setImmediate(r))
      expect(llamadasDeStatus()).toBe(antes)
      expect(store.proyectosRetenidosPor('project_limit_reached').map((p) => p.projectKey)).toEqual(['k-api'])
    } finally {
      store.close()
      cleanupTmp(dir)
    }
  })
})
