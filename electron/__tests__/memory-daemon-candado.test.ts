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
  const lock = { heartbeat: vi.fn(() => true), release: vi.fn() }
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

  // El detalle es un CÓDIGO, como los que ya emite el daemon ('offline', 'needs_key',
  // 'not_in_beta', 'auth'). El texto que ve el usuario lo decide el renderer: acá es main,
  // y un literal en inglés metido en el daemon además se saltea el i18n del repo.
  it('si otra instancia tiene el candado, lo dice con el código lock_held', async () => {
    const estados: Array<[DaemonStatus, string | undefined]> = []
    const c = candadoDoble(false)
    const daemon = new MemoryDaemon(deps(fakeStore(), {
      fetchImpl: fetchEspia().fn,
      adquirirCandado: c.adquirir,
      onStatusChange: (s: DaemonStatus, d?: string) => estados.push([s, d]),
    }))

    await daemon.push()

    expect(estados).toContainEqual(['paused', 'lock_held'])
  })

  // El evento push llega una sola vez; la pantalla Memories y Settings piden el estado con
  // `memory:status` cuando montan, que es un camino distinto. Sin esto, quien entra a
  // Settings DESPUÉS de que el daemon se pausó ve 'paused' sin ningún motivo.
  it('el detalle queda disponible para quien pregunte el estado después', async () => {
    const c = candadoDoble(false)
    const daemon = new MemoryDaemon(deps(fakeStore(), { fetchImpl: fetchEspia().fn, adquirirCandado: c.adquirir }))

    await daemon.push()

    expect(daemon.getStatus()).toBe('paused')
    expect(daemon.getStatusDetail()).toBe('lock_held')
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
    // Arrancado, como en Nest: sin start() lo suelta después de cada operación (ver abajo).
    daemon.start()

    await daemon.push()
    await asentar()
    await daemon.push()

    expect(c.adquirir).toHaveBeenCalledTimes(1)
    expect(c.lock.heartbeat).toHaveBeenCalled()
    daemon.stop()
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

  // Si otro nos lo robó (desde otra máquina, por antigüedad: el daemon de Nest sólo lo
  // refresca cuando sincroniza, y entre dos intervalos pasan más de 60 s), seguir
  // empujando sería sincronizar DOS a la vez — lo que el candado existe para evitar.
  it('si heartbeat dice que se lo robaron, lo vuelve a pedir y no empuja si el otro lo tiene', async () => {
    const red = fetchEspia()
    const lock = { heartbeat: vi.fn(() => false), release: vi.fn() }
    let llamadas = 0
    const adquirir = vi.fn(() => (llamadas++ === 0
      ? { ok: true as const, lock }
      : { ok: false as const, holder: { pid: 2000, host: 'maquina-b', at: 1 } }))
    const daemon = new MemoryDaemon(deps(fakeStore(), { fetchImpl: red.fn, adquirirCandado: adquirir }))
    daemon.start()
    await daemon.push()
    red.urls.length = 0

    await asentar()
    await daemon.push()

    expect(adquirir).toHaveBeenCalledTimes(2)
    expect(red.pusheo()).toBe(false)
    expect(daemon.getStatusDetail()).toBe('lock_held')
    daemon.stop()
  })

  // El paquete portátil nunca llama a start(): sus operaciones son sueltas, y el candado
  // protege una operación, no una sesión que dura lo que el editor siga abierto.
  it('sin start(), suelta el candado al terminar la operación aunque nadie llame a stop()', async () => {
    const c = candadoDoble(true)
    const daemon = new MemoryDaemon(deps(fakeStore(), { fetchImpl: fetchEspia().fn, adquirirCandado: c.adquirir }))

    await daemon.push()

    expect(c.lock.release).toHaveBeenCalledTimes(1)
  })

  it('arrancado, lo conserva entre operaciones: lo suelta stop()', async () => {
    const c = candadoDoble(true)
    const daemon = new MemoryDaemon(deps(fakeStore(), { fetchImpl: fetchEspia().fn, adquirirCandado: c.adquirir }))
    daemon.start()

    await daemon.push()

    expect(c.lock.release).not.toHaveBeenCalled()
    daemon.stop()
    expect(c.lock.release).toHaveBeenCalledTimes(1)
  })

  // El caso del MCP del paquete: `SyncDelMcp` llama a stop() apenas resuelve el push, pero
  // un push que avanzó y dejó cola encadena el siguiente con setImmediate, DESPUÉS de ese
  // stop(). Ese push encadenado volvía a tomar el candado y nadie lo soltaba: Nest, abierto
  // en la misma máquina, veía el PID vivo y no sincronizaba mientras el editor siguiera
  // abierto.
  it('un push encadenado después del stop() no deja el candado tomado', async () => {
    let pendientes = 1
    const store = fakeStore({
      pendingMutations: vi.fn(() => (pendientes > 0 ? UNA_MUTACION : [])),
      markPushed: vi.fn(() => { pendientes = 0 }),
      // Miente una vez a propósito: así el push encadena otro, que es el camino a cubrir.
      pendingMutationCount: vi.fn(() => 1),
    } as Partial<MemoryStore>)
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ results: [{ sync_id: 'a', outcome: 'applied' }] }),
    })) as unknown as typeof fetch
    const c = candadoDoble(true)
    const daemon = new MemoryDaemon(deps(store, { fetchImpl, adquirirCandado: c.adquirir }))

    await daemon.push()
    daemon.stop()
    await asentar()

    expect(c.adquirir.mock.calls.length).toBeGreaterThan(1)
    expect(c.lock.release).toHaveBeenCalledTimes(c.adquirir.mock.calls.length)
  })

  it('stop() suelta el candado, así la otra instancia no espera el ttl', async () => {
    const c = candadoDoble(true)
    const daemon = new MemoryDaemon(deps(fakeStore(), { fetchImpl: fetchEspia().fn, adquirirCandado: c.adquirir }))
    await daemon.push()

    daemon.stop()

    expect(c.lock.release).toHaveBeenCalled()
  })
})

/**
 * REGRESIÓN, no un test que manejó un cambio. Una revisión marcó "`doStatus` escribe sin el
 * candado" como plausible, y se descartó: `status` NO sincroniza, y lo que escribe es seguro
 * desde cualquier proceso que comparta la base.
 *
 * - `rememberKeyEpoch` sólo SUBE (el store ignora una época menor o igual). Es lo que arma el
 *   gate fail-closed del push, y tiene que armarse aunque a este proceso no le toque: si el
 *   que tiene el candado muere, éste lo toma y empuja en el mismo ciclo.
 * - `ensureProject` es idempotente y sólo agrega: un proyecto nuevo con cursor 0 que el
 *   dueño del candado iba a registrar igual en su propio status. No toca cursores ajenos.
 * - `unblockMutations` devuelve a la cola algo que ya no está bloqueado por la misma cuenta y
 *   la misma respuesta del servidor que vería el dueño. Lo peor es un push rechazado de nuevo
 *   que lo re-bloquea — el mismo costo que ya se acepta dentro de UN proceso, donde un push
 *   de `scheduleMutationPush` corre en paralelo con el status del drain.
 *
 * Y gatearlo con el candado sería PEOR: `status` pasaría a tomarlo, y un daemon sin `start()`
 * (el paquete) tendría un tercer camino que suelta —o no— el candado al quedar ocioso.
 */
describe('status() y el candado', () => {
  const STATUS_BODY = {
    key_epoch: 3,
    plan: 'cloud',
    quota: { used_bytes: 10, max_bytes: 100 },
    projects: [{ project_key: 'proj-nuevo', display_name: 'Repo nuevo' }],
  }

  function fetchConStatus() {
    const urls: string[] = []
    const fn = vi.fn(async (url: unknown) => {
      urls.push(String(url))
      const body = String(url).includes('/v1/sync/status') ? STATUS_BODY : {}
      return { ok: true, status: 200, json: async () => body }
    })
    return {
      fn: fn as unknown as typeof fetch,
      urls,
      pusheo: () => urls.some((u) => u.includes('/v1/sync/push')),
      pulleo: () => urls.some((u) => u.includes('/v1/sync/pull')),
    }
  }

  it('sin el candado, recuerda la época igual: el gate del push queda armado', async () => {
    const store = fakeStore()
    const c = candadoDoble(false)
    const daemon = new MemoryDaemon(deps(store, { fetchImpl: fetchConStatus().fn, adquirirCandado: c.adquirir }))

    const body = await daemon.status()

    expect(body).toEqual(STATUS_BODY)
    expect(store.rememberKeyEpoch).toHaveBeenCalledWith(3)
    // Lo que sólo informa a la UI también llega, aunque no le toque sincronizar.
    expect(daemon.getQuota()).toEqual(STATUS_BODY.quota)
    expect(daemon.getPlan()).toBe('cloud')
  })

  it('status nunca toma el candado, así que no puede dejarlo tomado', async () => {
    const c = candadoDoble(true)
    const daemon = new MemoryDaemon(deps(fakeStore(), { fetchImpl: fetchConStatus().fn, adquirirCandado: c.adquirir }))

    await daemon.status()

    expect(c.adquirir).not.toHaveBeenCalled()
    expect(c.lock.release).not.toHaveBeenCalled()
  })

  it('sin el candado, sus escrituras son las idempotentes de siempre y no sale nada más', async () => {
    const store = fakeStore()
    const red = fetchConStatus()
    const c = candadoDoble(false)
    const daemon = new MemoryDaemon(deps(store, { fetchImpl: red.fn, adquirirCandado: c.adquirir }))

    await daemon.status()

    expect(store.unblockMutations).toHaveBeenCalledWith(['quota_exceeded'])
    expect(store.ensureProject).toHaveBeenCalledWith({ projectKey: 'proj-nuevo', displayName: 'Repo nuevo' })
    expect(red.pusheo()).toBe(false)
    expect(red.pulleo()).toBe(false)
  })

  // El orden que importa en la práctica: un push que tiene que esperar al primer status
  // (`isEncryptionExpected`) en un proceso que NO tiene el candado no sale, y el status que
  // corrió para el gate no le dejó el candado tomado a nadie.
  it('un push sin candado que espera el primer status no empuja ni toma el candado', async () => {
    const red = fetchConStatus()
    const c = candadoDoble(false)
    const daemon = new MemoryDaemon(deps(fakeStore(), {
      fetchImpl: red.fn,
      adquirirCandado: c.adquirir,
      isEncryptionExpected: () => true,
    }))

    await daemon.push()

    expect(red.pusheo()).toBe(false)
    expect(c.lock.release).not.toHaveBeenCalled()
    expect(daemon.getStatusDetail()).toBe('lock_held')
  })
})
