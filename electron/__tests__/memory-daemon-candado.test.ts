import { describe, it, expect, vi } from 'vitest'
import { MemoryDaemon, type DaemonStatus } from '../memory-daemon'
import { MemoryStore, type MutationLogRow } from '../memory-store'

/**
 * §6.3 del spec `2026-09-13-nest-memory-portable-design.md`: el daemon no sincroniza
 * si otro ya tiene el candado de esta base. Escribe local y encola, y lo dice.
 *
 * El caso real que cierra: la app instalada y un build de desarrollo comparten
 * `~/.raven-nest` y ponen DOS daemons sobre la misma cuenta — dos copias del token y
 * dos pushers compitiendo. Ya pasa hoy, sin paquete portátil de por medio.
 *
 * La dep es OPCIONAL a propósito: sin ella el daemon sincroniza como siempre, así que
 * ningún call site ni test anterior al candado cambia.
 */

const UNA_MUTACION: MutationLogRow[] = [
  { seq: 1, sync_id: 'a', op: 'upsert', payload: JSON.stringify({ sync_id: 'a', project_key: 'proj-1' }), created_at: 1, pushed_at: null, last_error: null, blocked_reason: null },
]

function fakeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    pendingMutations: vi.fn(() => UNA_MUTACION),
    markPushed: vi.fn(),
    blockMutations: vi.fn(),
    blockedMutations: vi.fn(() => []),
    unblockMutations: vi.fn(),
    setSyncState: vi.fn(),
    getSyncState: vi.fn(() => ({ pullCursor: 0, lastPushSeq: 0 })),
    listProjects: vi.fn(() => [{ projectKey: 'proj-1', displayName: 'proj-1', enrolled: true }]),
    pruneAckedMutations: vi.fn(() => 0),
    pendingMutationCount: vi.fn(() => 1),
    compactMutationLog: vi.fn(() => 0),
    get: vi.fn(() => null),
    findActiveTopicOwner: vi.fn(() => null),
    applyIncomingObservation: vi.fn(),
    ensureProject: vi.fn(),
    markUndecryptable: vi.fn(),
    clearUndecryptableFor: vi.fn(),
    undecryptableCount: vi.fn(() => 0),
    clearUndecryptable: vi.fn(),
    findActiveTopicOwnerByHmac: vi.fn(() => null),
    knownKeyEpoch: vi.fn(() => 0),
    rememberKeyEpoch: vi.fn(),
    ...overrides,
  } as unknown as MemoryStore
}

/** Espía de red que guarda las URLs, para poder afirmar sobre lo que SALIÓ. */
function fetchEspia() {
  const urls: string[] = []
  const fn = vi.fn(async (url: unknown) => {
    urls.push(String(url))
    return { ok: true, status: 200, json: async () => ({}) }
  })
  return {
    fn: fn as unknown as typeof fetch,
    urls,
    pusheo: () => urls.some((u) => u.includes('/v1/sync/push')),
    pulleo: () => urls.some((u) => u.includes('/v1/sync/pull')),
  }
}

function candadoDoble(conseguido: boolean) {
  const lock = { heartbeat: vi.fn(), release: vi.fn() }
  const adquirir = vi.fn(() => conseguido
    ? { ok: true as const, lock }
    : { ok: false as const, holder: { pid: 999, host: 'otra-instancia', at: 1 } })
  return { adquirir, lock }
}

function deps(store: MemoryStore, extra: Record<string, unknown> = {}) {
  return {
    store,
    getSyncBaseUrl: () => 'https://sync.example.com',
    getToken: () => 'nmk_test',
    getDeviceId: () => 'device-1',
    isOnline: () => true,
    ...extra,
  } as ConstructorParameters<typeof MemoryDaemon>[0]
}

const asentar = () => new Promise((r) => setTimeout(r, 10))

describe('el daemon y el candado de sincronización', () => {
  it('sin la dep del candado empuja como siempre', async () => {
    const red = fetchEspia()
    const daemon = new MemoryDaemon(deps(fakeStore(), { fetchImpl: red.fn }))

    await daemon.push()

    expect(red.pusheo()).toBe(true)
  })

  it('si otra instancia tiene el candado, no empuja', async () => {
    const red = fetchEspia()
    const c = candadoDoble(false)
    const daemon = new MemoryDaemon(deps(fakeStore(), { fetchImpl: red.fn, adquirirCandado: c.adquirir }))

    await daemon.push()

    expect(red.pusheo()).toBe(false)
  })

  it('si otra instancia tiene el candado, tampoco baja: los cursores son de uno solo', async () => {
    const red = fetchEspia()
    const c = candadoDoble(false)
    const daemon = new MemoryDaemon(deps(fakeStore(), { fetchImpl: red.fn, adquirirCandado: c.adquirir }))

    await daemon.pull()

    expect(red.pulleo()).toBe(false)
  })

  it('si otra instancia tiene el candado, lo dice en vez de fallar en silencio', async () => {
    const estados: Array<[DaemonStatus, string | undefined]> = []
    const c = candadoDoble(false)
    const daemon = new MemoryDaemon(deps(fakeStore(), {
      fetchImpl: fetchEspia().fn,
      adquirirCandado: c.adquirir,
      onStatusChange: (s: DaemonStatus, d?: string) => estados.push([s, d]),
    }))

    await daemon.push()

    expect(estados.some(([s]) => s === 'paused')).toBe(true)
    expect(estados.some(([, d]) => !!d && /otra-instancia|999/.test(d))).toBe(true)
  })

  it('con el candado propio empuja normal', async () => {
    const red = fetchEspia()
    const c = candadoDoble(true)
    const daemon = new MemoryDaemon(deps(fakeStore(), { fetchImpl: red.fn, adquirirCandado: c.adquirir }))

    await daemon.push()

    expect(red.pusheo()).toBe(true)
    expect(c.adquirir).toHaveBeenCalledTimes(1)
  })

  it('no lo vuelve a pedir en cada push: lo refresca con heartbeat', async () => {
    const red = fetchEspia()
    const c = candadoDoble(true)
    const daemon = new MemoryDaemon(deps(fakeStore(), { fetchImpl: red.fn, adquirirCandado: c.adquirir }))

    await daemon.push()
    await asentar()
    await daemon.push()

    expect(c.adquirir).toHaveBeenCalledTimes(1)
    expect(c.lock.heartbeat).toHaveBeenCalled()
  })

  // REGRESIÓN, no un test que manejó un cambio: pause() ya suelta el candado porque llama
  // a stop(), que es donde está el release. Se fija acá porque esa dependencia no es obvia
  // y la propiedad importa: un swap de cuenta cambia la BASE y el candado es por base, así
  // que si pause() dejara de pasar por stop(), el daemon quedaría con el candado de la base
  // vieja tomado y nunca pediría el de la nueva.
  it('pause() suelta el candado: después de un swap el candado viejo no queda tomado', async () => {
    const c = candadoDoble(true)
    const daemon = new MemoryDaemon(deps(fakeStore(), { fetchImpl: fetchEspia().fn, adquirirCandado: c.adquirir }))
    await daemon.push()

    await daemon.pause()

    expect(c.lock.release).toHaveBeenCalled()
    // Y el siguiente ciclo vuelve a pedirlo — con el path de la base nueva.
    daemon.resume()
    await daemon.push()
    expect(c.adquirir).toHaveBeenCalledTimes(2)
  })

  it('stop() suelta el candado, así la otra instancia no espera el ttl', async () => {
    const c = candadoDoble(true)
    const daemon = new MemoryDaemon(deps(fakeStore(), { fetchImpl: fetchEspia().fn, adquirirCandado: c.adquirir }))
    await daemon.push()

    daemon.stop()

    expect(c.lock.release).toHaveBeenCalled()
  })
})
