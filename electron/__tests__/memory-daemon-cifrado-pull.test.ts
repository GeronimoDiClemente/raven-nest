import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { MemoryDaemon, mapRawPulledRow } from '../memory-daemon'
import { deriveKeys, generateMasterKey, hmacTopicKey } from '../memory-crypto'
import { sealMutationPayload, type EnvelopeContext } from '../memory-envelope'

const ctx: EnvelopeContext = { keys: deriveKeys(generateMasterKey()), keyEpoch: 1 }

let dir: string
let store: MemoryStore

const filaCruda = (sellado: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
  sync_id: sellado.sync_id, project_key: sellado.project_key, scope: sellado.scope,
  type: sellado.type, topic_key: sellado.topic_key, title: sellado.title,
  content: sellado.content, tags: sellado.tags, content_hash: sellado.content_hash,
  lamport: 5, client_updated_at: new Date(1_700_000_000_000).toISOString(),
  deleted: false, superseded_by: null, project_seq: 10, ...overrides,
})

const sellar = (over: Record<string, unknown> = {}) => sealMutationPayload(ctx, {
  sync_id: 'obs_remoto', project_key: 'proj1', project_display_name: 'raven-nest',
  scope: 'personal', type: 'decision', topic_key: 'deploy',
  title: 'la decision remota', content: 'el cuerpo remoto', tags: ['release'],
  content_hash: 'h1', lamport: 5, updated_at: 1_700_000_000_000, ...over,
})

function daemonCon(getEnvelopeContext: () => EnvelopeContext | null) {
  return new MemoryDaemon({
    store,
    getSyncBaseUrl: () => 'http://sync.test',
    getToken: () => 'nmk_test',
    getDeviceId: () => 'device-1',
    isOnline: () => true,
    fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ rows: [], cursors: {} }) })) as unknown as typeof fetch,
    getEnvelopeContext,
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nest-pull-cifrado-'))
  store = new MemoryStore(join(dir, 'memory.db'))
  store.ensureProject({ projectKey: 'proj1', displayName: 'raven-nest' })
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

describe('applyPulledRow con cifrado', () => {
  it('descifra y guarda el texto en claro en la base local', () => {
    daemonCon(() => ctx).applyPulledRow(mapRawPulledRow(filaCruda(sellar())))
    const row = store.get('obs_remoto')!
    expect(row.title).toBe('la decision remota')
    expect(row.content).toBe('el cuerpo remoto')
    expect(JSON.parse(row.tags!)).toEqual(['release'])
    expect(row.topic_key_hmac).toBe(hmacTopicKey(ctx.keys, 'proj1', 'personal', 'deploy'))
  })

  // El bug que la Task 5 existe para evitar: sin HMAC local, esto duplicaba el slot.
  it('el supersede por tópico encuentra al dueño local por HMAC', () => {
    store.setTopicHasher((p, s, t) => hmacTopicKey(ctx.keys, p, s, t))
    const local = store.save({
      projectKey: 'proj1', scope: 'personal', type: 'decision', topicKey: 'deploy',
      title: 'la vieja', content: 'x', source: 'mcp',
    })
    // La remota es mas nueva, asi que gana el slot.
    daemonCon(() => ctx).applyPulledRow(mapRawPulledRow(filaCruda(sellar(), {
      client_updated_at: new Date(Date.now() + 60_000).toISOString(),
    })))
    expect(store.get(local.syncId)!.superseded_by).toBe('obs_remoto')
    expect(store.get('obs_remoto')!.superseded_by).toBeNull()
  })

  it('sin clave, la fila NO se aplica y se cuenta como ilegible', () => {
    daemonCon(() => null).applyPulledRow(mapRawPulledRow(filaCruda(sellar())))
    expect(store.get('obs_remoto')).toBeNull()
    expect(store.undecryptableCount()).toBe(1)
  })

  it('con la clave equivocada tampoco se aplica, y no lanza', () => {
    const otro: EnvelopeContext = { keys: deriveKeys(generateMasterKey()), keyEpoch: 1 }
    expect(() => daemonCon(() => otro).applyPulledRow(mapRawPulledRow(filaCruda(sellar())))).not.toThrow()
    expect(store.get('obs_remoto')).toBeNull()
    expect(store.undecryptableCount()).toBe(1)
  })

  it('una fila en claro anterior a la migración se aplica igual', () => {
    const enClaro = {
      sync_id: 'obs_viejo', project_key: 'proj1', scope: 'personal', type: 'decision',
      topic_key: 'deploy', title: 'texto viejo', content: 'cuerpo viejo', tags: ['x'],
      content_hash: 'h', lamport: 1, updated_at: 1_600_000_000_000,
    }
    daemonCon(() => ctx).applyPulledRow(mapRawPulledRow(filaCruda(enClaro)))
    const row = store.get('obs_viejo')!
    expect(row.title).toBe('texto viejo')
    expect(row.topic_key).toBe('deploy')
    expect(row.topic_key_hmac).toBe(hmacTopicKey(ctx.keys, 'proj1', 'personal', 'deploy'))
    expect(store.undecryptableCount()).toBe(0)
  })

  it('resetPullCursors vuelve a traer lo que quedó afuera', () => {
    store.setSyncState('proj1', { pullCursor: 99 })
    store.markUndecryptable("obs-ilegible")
    store.resetPullCursors()
    store.clearUndecryptable()
    expect(store.getSyncState('proj1').pullCursor).toBe(0)
    expect(store.undecryptableCount()).toBe(0)
  })
})

// `pause()` espera el drain 5s y el timeout del fetch es 30s: con una red lenta el usuario
// cambia de cuenta con un pull en vuelo. `doPull` capturaba el store al entrar pero
// `applyPulledRow` leía `this.deps.store` EN VIVO, así que las filas de la cuenta A —con su
// `author_user_id`— terminaban escritas en la base de la cuenta B.
describe('un pull en vuelo durante un cambio de cuenta', () => {
  it('descarta las filas en vez de escribirlas en la base de la otra cuenta', async () => {
    const dirB = mkdtempSync(join(tmpdir(), 'nest-cuenta-b-'))
    const storeB = new MemoryStore(join(dirB, 'memory.db'))

    let soltarRespuesta: () => void = () => {}
    const fetchImpl = (async () => {
      await new Promise<void>((r) => { soltarRespuesta = r })
      return {
        ok: true, status: 200,
        json: async () => ({
          rows: [{
            sync_id: 'obs-de-A', project_key: 'proj1', scope: 'personal', type: 'decision',
            title: 'memoria de la cuenta A', content: 'no puede terminar en B',
            tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
          }],
          cursors: {},
        }),
      } as unknown as Response
    }) as unknown as typeof fetch

    const daemon = new MemoryDaemon({
      store,
      getSyncBaseUrl: () => 'http://sync.test',
      getToken: () => 'tok',
      getDeviceId: () => 'dev',
      isOnline: () => true,
      fetchImpl,
    })

    const enVuelo = daemon.pull()
    // El swap ocurre con el pull todavía esperando respuesta.
    daemon.setStore(storeB)
    soltarRespuesta()
    await enVuelo

    expect(storeB.count(), 'la base de B no recibió nada de A').toBe(0)
    storeB.close()
    rmSync(dirB, { recursive: true, force: true })
  })
})

// `project_display_name` viaja cifrado, y el roster que devuelve `/v1/status` lo trae tal
// cual. Una máquina que todavía no conocía ese proyecto creaba el proyecto local llamado
// `nmc1:pQx8…` —el usuario veía eso en lugar del nombre de su repo— y en el push siguiente
// ese string se volvía a cifrar sobre sí mismo: cada ciclo agregaba una capa.
describe('el nombre de proyecto que vuelve del roster', () => {
  it('un nombre cifrado no se escribe como nombre local: cae a la clave del proyecto', async () => {
    const fetchImpl = (async (url: string) => ({
      ok: true, status: 200,
      json: async () => (String(url).includes('/status')
        ? { projects: [{ project_key: 'proj-remoto', display_name: 'nmc1:cualquierCosaBase64==' }] }
        : { rows: [], cursors: {} }),
    } as unknown as Response)) as unknown as typeof fetch

    const daemon = new MemoryDaemon({
      store,
      getSyncBaseUrl: () => 'http://sync.test',
      getToken: () => 'tok',
      getDeviceId: () => 'dev',
      isOnline: () => true,
      fetchImpl,
    })
    daemon.onNetworkRegain()
    await new Promise((r) => setTimeout(r, 600))

    const proyecto = store.listProjects().find((p) => p.projectKey === 'proj-remoto')
    if (proyecto) {
      expect(proyecto.displayName).toBe('proj-remoto')
      expect(proyecto.displayName).not.toMatch(/^nmc1:/)
    }
  })
})

// El contador que la tarjeta le muestra al usuario decía cuántas VECES intentó, no cuántas
// memorias no puede leer: sumaba de nuevo las mismas filas en cada re-pull —y
// `resetPullCursors` vuelve a traer todo a propósito— y nunca bajaba.
describe('el conteo de memorias ilegibles', () => {
  it('la misma fila re-pulleada no se cuenta dos veces', () => {
    const sellado = sellar({ sync_id: 'obs-repetida' })
    const daemon = daemonCon(() => null) // sin clave: no la puede abrir
    const fila = mapRawPulledRow(sellado as Record<string, unknown>)
    daemon.applyPulledRow(fila)
    daemon.applyPulledRow(fila)
    daemon.applyPulledRow(fila)
    expect(store.undecryptableCount()).toBe(1)
  })

  it('cuando la fila SÍ se puede abrir, deja de contarse', () => {
    const sellado = sellar({ sync_id: 'obs-recuperable' })
    const sinClave = daemonCon(() => null)
    sinClave.applyPulledRow(mapRawPulledRow(sellado as Record<string, unknown>))
    expect(store.undecryptableCount()).toBe(1)

    // La máquina consigue la clave y vuelve a bajar la misma fila.
    const conClave = daemonCon(() => ctx)
    conClave.applyPulledRow(mapRawPulledRow(sellado as Record<string, unknown>))
    expect(store.undecryptableCount()).toBe(0)
  })
})

/**
 * El fail-closed del push, armado por el propio pull.
 *
 * La época conocida sólo se escribía desde el handler de estado de la tarjeta de cifrado —o
 * sea que el gate sólo se armaba si el usuario ABRÍA el overlay Memories. Una máquina nueva
 * que conecta la nube corre import + drain y empujaba TODO en claro a una cuenta cifrada:
 * el agujero que el gate existe para tapar, abierto justo en la máquina que importa, la que
 * no tiene la clave.
 *
 * El caso exacto: store nuevo con `knownKeyEpoch() === 0`, un pull que trae una fila
 * cifrada, y el push siguiente en `error/needs_key` en vez de subir en claro.
 */
describe('el gate del push se arma solo al ver una fila cifrada', () => {
  it('un store nuevo que pullea cifrado deja de pushear en claro', async () => {
    expect(store.knownKeyEpoch(), 'arranca sin saber nada del cifrado').toBe(0)

    // Hay algo local esperando subir, guardado antes de enterarse de nada.
    store.save({
      projectKey: 'proj1', scope: 'personal', type: 'decision',
      title: 'esto no puede subir en claro', content: 'secreto', source: 'mcp',
    })
    expect(store.pendingMutations(10).length).toBeGreaterThan(0)

    const subidas: unknown[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('/push')) {
        subidas.push(JSON.parse(String(init?.body ?? '{}')))
        return { ok: true, status: 200, json: async () => ({ receipts: [] }) } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({ rows: [], cursors: {} }) } as unknown as Response
    }) as unknown as typeof fetch

    // El detalle del estado no se puede leer de `getStatus()` —devuelve sólo el estado— y es
    // el que la UI usa para ofrecer autorizar la máquina. Se captura por el callback.
    const avisos: Array<[string, string | undefined]> = []

    // Esta máquina NO tiene la clave: `getEnvelopeContext` devuelve null.
    const daemon = new MemoryDaemon({
      store,
      getSyncBaseUrl: () => 'http://sync.test',
      getToken: () => 'tok',
      getDeviceId: () => 'dev',
      isOnline: () => true,
      fetchImpl,
      getEnvelopeContext: () => null,
      isEncryptionExpected: () => store.knownKeyEpoch() > 0,
      onStatusChange: (estado, detalle) => { avisos.push([estado, detalle]) },
    })

    // Baja una fila que no puede abrir. Eso —y sólo eso— es la prueba de que la cuenta cifra.
    daemon.applyPulledRow(mapRawPulledRow(filaCruda(sellar())))
    expect(store.knownKeyEpoch(), 'ver ciphertext arma el gate').toBeGreaterThan(0)

    await daemon.push()

    expect(subidas, 'no subió nada').toEqual([])
    expect(daemon.getStatus()).toBe('error')
    expect(avisos.at(-1)).toEqual(['error', 'needs_key'])
    // Y lo que importa para el usuario: la cola NO se perdió, espera.
    expect(store.pendingMutations(10).length).toBeGreaterThan(0)
  })

  // El control: sin haber visto nunca una fila cifrada, el push normal sigue funcionando.
  // Sin este caso, un gate trabado en "siempre cerrado" pasaría el test de arriba.
  it('sin señales de cifrado el push sigue subiendo normal', async () => {
    store.save({
      projectKey: 'proj1', scope: 'personal', type: 'decision',
      title: 'una cuenta sin cifrado', content: 'x', source: 'mcp',
    })
    const subidas: unknown[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('/push')) {
        subidas.push(JSON.parse(String(init?.body ?? '{}')))
        return { ok: true, status: 200, json: async () => ({ receipts: [] }) } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({ rows: [], cursors: {} }) } as unknown as Response
    }) as unknown as typeof fetch

    const daemon = new MemoryDaemon({
      store,
      getSyncBaseUrl: () => 'http://sync.test',
      getToken: () => 'tok',
      getDeviceId: () => 'dev',
      isOnline: () => true,
      fetchImpl,
      getEnvelopeContext: () => null,
      isEncryptionExpected: () => store.knownKeyEpoch() > 0,
    })

    await daemon.push()
    expect(subidas).toHaveLength(1)
    expect(daemon.getStatus()).not.toBe('error')
  })
})

/**
 * El swap de cuenta con un push o un status en vuelo.
 *
 * `doPull` ya descartaba su respuesta cuando la generación cambiaba; `doPush` y `doStatus`
 * no. El modo de falla es peor que escribir en la base equivocada: el orquestador CIERRA el
 * store viejo antes de poner el nuevo (pause → close → rename/reopen → setStore), así que
 * `markPushed` sobre él tira "The database connection is not open" — y como el `catch`
 * también escribía en ese store, la excepción de SQLite se escapaba de `doPush`.
 *
 * Verificado antes del arreglo: `push()` rechazaba y el estado quedaba en `syncing` para
 * siempre. En producción el llamador es `void this.push()`: una unhandled rejection, y una
 * UI que dice "sincronizando" hasta reiniciar la app.
 */
describe('un swap de cuenta con un push en vuelo', () => {
  const daemonConFetchLento = (storeInicial: MemoryStore, ruta: string) => {
    let soltar: () => void = () => {}
    const fetchImpl = (async (url: string) => {
      if (String(url).includes(ruta)) {
        await new Promise<void>((r) => { soltar = r })
        return {
          ok: true, status: 200,
          json: async () => ({ results: [], plan: 'pro', projects: [{ project_key: 'de-la-otra-cuenta', display_name: 'x' }] }),
        } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({ rows: [], cursors: {} }) } as unknown as Response
    }) as unknown as typeof fetch

    const daemon = new MemoryDaemon({
      store: storeInicial,
      getSyncBaseUrl: () => 'http://sync.test',
      getToken: () => 'tok',
      getDeviceId: () => 'dev',
      isOnline: () => true,
      fetchImpl,
    })
    return { daemon, soltar: () => soltar() }
  }

  it('el push no explota contra el store cerrado de la cuenta anterior', async () => {
    const dirB = mkdtempSync(join(tmpdir(), 'nest-swap-b-'))
    const storeB = new MemoryStore(join(dirB, 'memory.db'))
    store.save({
      projectKey: 'proj1', scope: 'personal', type: 'decision',
      title: 'de la cuenta A', content: 'x', source: 'mcp',
    })

    const { daemon, soltar } = daemonConFetchLento(store, '/push')
    const enVuelo = daemon.push()
    // Exactamente lo que hace el orquestador, en ese orden.
    store.close()
    daemon.setStore(storeB)
    soltar()

    await expect(enVuelo, 'no lanza').resolves.toBeUndefined()
    // `idle` y no `error`: el swap es un descarte limpio, no una excepción de SQLite
    // atajada. Con sólo endurecer el `catch` —y sin el guard de generación— esto daría
    // `error`, que es lo que la UI le muestra al usuario como "algo falló".
    expect(daemon.getStatus()).toBe('idle')

    storeB.close()
    rmSync(dirB, { recursive: true, force: true })
    // `afterEach` cierra `store`; cerrarlo dos veces no rompe, pero la base ya no existe.
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  it('el status no registra el roster de la cuenta anterior ni explota', async () => {
    const dirB = mkdtempSync(join(tmpdir(), 'nest-swap-status-b-'))
    const storeB = new MemoryStore(join(dirB, 'memory.db'))

    const { daemon, soltar } = daemonConFetchLento(store, '/status')
    const enVuelo = daemon.status()
    store.close()
    daemon.setStore(storeB)
    soltar()

    await expect(enVuelo).resolves.toBeTruthy()
    expect(
      storeB.listProjects().map((p) => p.projectKey),
      'el roster de A no se escribe en la base de B'
    ).not.toContain('de-la-otra-cuenta')

    storeB.close()
    rmSync(dirB, { recursive: true, force: true })
    store = new MemoryStore(join(dir, 'memory.db'))
  })
})

/**
 * El crítico de la TERCERA revisión: el gate fail-closed no llegaba a armarse.
 *
 * `isEncryptionExpected()` es `store.knownKeyEpoch() > 0` (main.ts), y esa época tenía dos
 * escritores: los handlers de la tarjeta de cifrado —que sólo corren si el usuario ABRE el
 * overlay Memories— y `applyPulledRow` al bajar una fila que no puede abrir. Ninguno corre en
 * el camino normal de una máquina que todavía no tiene la clave.
 *
 * Y no es una carrera, es el estado por defecto: activar el cifrado NO re-cifra lo ya subido,
 * así que una cuenta que venía sincronizando en claro deja al servidor lleno de filas
 * legibles. La segunda máquina nunca baja algo que no pueda abrir, la época se queda en 0
 * para siempre, y sigue subiendo título y contenido EN CLARO con estado `idle`, mientras la
 * tarjeta le dice al usuario que la cuenta está cifrada.
 *
 * El arreglo: `/v1/sync/status` devuelve `key_epoch` y `doStatus` lo persiste antes del pull
 * y del push. Es el único camino que corre en todo drain.
 */
describe('el gate se arma por el status, sin depender de ver ciphertext', () => {
  const servidor = (opciones: { keyEpoch?: number; filas?: unknown[] }) => {
    const subidas: Array<Record<string, unknown>> = []
    const urls: string[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      urls.push(String(url))
      const ok = (j: unknown) => ({ ok: true, status: 200, json: async () => j } as unknown as Response)
      if (String(url).includes('/status')) {
        return ok({
          device_id: 'dev', user_id: 'u', plan: 'pro', next_poll_ms: 300_000,
          quota: { used_bytes: 0, max_bytes: 1_000_000 }, projects: [],
          // Ausente a propósito cuando no se pide: es el servicio viejo.
          ...(opciones.keyEpoch === undefined ? {} : { key_epoch: opciones.keyEpoch }),
        })
      }
      if (String(url).includes('/pull')) return ok({ rows: opciones.filas ?? [], cursors: {} })
      // `payload` viaja como OBJETO, no como string: el daemon lo arma y `JSON.stringify` del
      // cuerpo entero lo serializa una sola vez.
      const body = JSON.parse(String(init?.body ?? '{}')) as { mutations?: Array<{ payload?: Record<string, unknown> }> }
      for (const m of body.mutations ?? []) subidas.push(m.payload ?? {})
      return ok({ results: [] })
    }) as unknown as typeof fetch
    return { fetchImpl, subidas, urls }
  }

  // El cableado EXACTO de main.ts:422, para que el test no pruebe una versión más amable.
  const daemonReal = (fetchImpl: typeof fetch) => new MemoryDaemon({
    store,
    getSyncBaseUrl: () => 'http://sync.test',
    getToken: () => 'tok',
    getDeviceId: () => 'dev',
    isOnline: () => true,
    fetchImpl,
    getEnvelopeContext: () => null,                       // esta máquina NO tiene la clave
    isEncryptionExpected: () => store.knownKeyEpoch() > 0,
  })

  const guardarAlgoPrivado = () => store.save({
    projectKey: 'proj1', scope: 'personal', type: 'decision',
    title: 'mi decisión privada', content: 'el cuerpo privado', source: 'mcp',
  })

  it('un drain sin una sola fila cifrada YA deja el push cerrado', async () => {
    guardarAlgoPrivado()
    // La cuenta cifra (época 1) pero todo lo que hay en la nube es anterior y está en claro:
    // el pull vuelve vacío, así que no hay ciphertext que ver en ningún momento.
    const srv = servidor({ keyEpoch: 1, filas: [] })
    const daemon = daemonReal(srv.fetchImpl)

    daemon.onNetworkRegain()
    await new Promise((r) => setTimeout(r, 700))

    expect(store.knownKeyEpoch(), 'el status la trajo').toBe(1)
    expect(srv.subidas, 'no subió una sola memoria').toEqual([])
    expect(daemon.getStatus()).toBe('error')
  })

  // El camino que ni siquiera pasa por el drain: el MCP escribe y `scheduleMutationPush()`
  // dispara `push()` directo, sin status ni pull de por medio.
  it('un push directo, sin drain, tampoco sale en claro', async () => {
    guardarAlgoPrivado()
    const srv = servidor({ keyEpoch: 1 })
    const daemon = daemonReal(srv.fetchImpl)

    await daemon.push()

    expect(srv.urls.some((u) => u.includes('/status')), 'pidió el status antes de pushear').toBe(true)
    expect(srv.subidas).toEqual([])
    expect(daemon.getStatus()).toBe('error')
  })

  it('con la cuenta SIN cifrado, el push sigue subiendo normal', async () => {
    guardarAlgoPrivado()
    const srv = servidor({ keyEpoch: 0 })
    const daemon = daemonReal(srv.fetchImpl)

    await daemon.push()

    expect(store.knownKeyEpoch()).toBe(0)
    expect(srv.subidas).toHaveLength(1)
    expect(srv.subidas[0].title).toBe('mi decisión privada')
  })

  // Un servicio viejo no manda el campo. "No sé" no es lo mismo que "0 = no cifra": no puede
  // DESARMAR un gate que otra señal ya armó.
  it('un servicio viejo sin el campo no desarma el gate que el pull armó', async () => {
    store.rememberKeyEpoch(1)          // ya vimos ciphertext alguna vez
    guardarAlgoPrivado()
    const srv = servidor({})           // sin key_epoch en la respuesta
    const daemon = daemonReal(srv.fetchImpl)

    await daemon.push()

    expect(store.knownKeyEpoch(), 'sigue armado').toBe(1)
    expect(srv.subidas).toEqual([])
  })
})
