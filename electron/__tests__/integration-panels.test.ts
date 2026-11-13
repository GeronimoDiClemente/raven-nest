import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerPanelAdapter, resetPanelAdapters, callPanel, NotConnectedError,
  type PanelAdapterDeps, type ServerPanelAdapter, type DetailModel,
} from '../integration-panels'

function makeDeps(overrides: Partial<PanelAdapterDeps> = {}): PanelAdapterDeps {
  return {
    getToken: () => 'tok-123',
    getConfig: () => ({}),
    fetch: (() => Promise.resolve({ ok: true } as Response)) as unknown as typeof fetch,
    ...overrides,
  }
}

function makeAdapter(over: Partial<ServerPanelAdapter> = {}): ServerPanelAdapter {
  const detail: DetailModel = {
    ref: { sectionId: 'mine', itemId: 'x-1' },
    title: 'Item x-1',
    status: 'Open',
    meta: [],
    blocks: [],
  }
  return {
    fetchSections: async () => [{ id: 'mine', label: 'My work', items: [] }],
    fetchDetail: async () => detail,
    resolveWorktreeEntity: async () => ({ sectionId: 'mine', itemId: 'x-1' }),
    actions: () => [{ id: 'close', label: 'Close', kind: 'primary' }],
    runAction: async () => {},
    compose: async () => {},
    ...over,
  }
}

describe('integration-panels host', () => {
  beforeEach(() => resetPanelAdapters())

  it('enruta fetchSections al adapter registrado', async () => {
    registerPanelAdapter('demo', () => makeAdapter())
    const res = await callPanel('demo', 'fetchSections', [{ repoPath: null, branch: null }], makeDeps())
    expect(res).toEqual({ ok: true, data: [{ id: 'mine', label: 'My work', items: [] }] })
  })

  it('fetchDetail empaqueta detail + actions (actions es sync en el contrato)', async () => {
    registerPanelAdapter('demo', () => makeAdapter())
    const res = await callPanel('demo', 'fetchDetail', [{ sectionId: 'mine', itemId: 'x-1' }], makeDeps())
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('unreachable')
    expect(res.data).toEqual({
      detail: { ref: { sectionId: 'mine', itemId: 'x-1' }, title: 'Item x-1', status: 'Open', meta: [], blocks: [] },
      actions: [{ id: 'close', label: 'Close', kind: 'primary' }],
    })
  })

  it('pasa los args en orden a runAction/compose', async () => {
    let seen: unknown[] = []
    registerPanelAdapter('demo', () => makeAdapter({
      runAction: async (...args: unknown[]) => { seen = args },
    }))
    await callPanel('demo', 'runAction', ['close', { sectionId: 'mine', itemId: 'x-1' }], makeDeps())
    expect(seen).toEqual(['close', { sectionId: 'mine', itemId: 'x-1' }])
  })

  it('inyecta los deps recibidos al factory del adapter', async () => {
    let receivedDeps: PanelAdapterDeps | null = null
    registerPanelAdapter('demo', (deps) => {
      receivedDeps = deps
      return makeAdapter()
    })
    const deps = makeDeps({ getToken: () => 'abc' })
    await callPanel('demo', 'fetchSections', [{ repoPath: null, branch: null }], deps)
    expect(receivedDeps).toBe(deps)
  })

  it('NOT_CONNECTED cuando el adapter tira NotConnectedError', async () => {
    registerPanelAdapter('demo', () => makeAdapter({
      fetchSections: async () => { throw new NotConnectedError() },
    }))
    const res = await callPanel('demo', 'fetchSections', [{ repoPath: null, branch: null }], makeDeps({ getToken: () => null }))
    expect(res).toEqual({ ok: false, error: 'NOT_CONNECTED' })
  })

  it('API_ERROR cuando el adapter tira un Error genérico', async () => {
    registerPanelAdapter('demo', () => makeAdapter({
      fetchSections: async () => { throw new Error('boom') },
    }))
    const res = await callPanel('demo', 'fetchSections', [{ repoPath: null, branch: null }], makeDeps())
    expect(res).toEqual({ ok: false, error: 'API_ERROR', message: 'boom' })
  })

  it('NOT_FOUND si el plugin no tiene adapter registrado', async () => {
    const res = await callPanel('nope', 'fetchSections', [], makeDeps())
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error).toBe('NOT_FOUND')
  })

  it('NOT_FOUND si el método no existe / no es invocable (p.ej. "actions" no viaja por IPC)', async () => {
    registerPanelAdapter('demo', () => makeAdapter())
    const res = await callPanel('demo', 'actions', [], makeDeps())
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error).toBe('NOT_FOUND')

    const res2 = await callPanel('demo', 'doesNotExist', [], makeDeps())
    expect(res2).toEqual({ ok: false, error: 'NOT_FOUND', message: 'Unknown panel method "doesNotExist"' })
  })
})
