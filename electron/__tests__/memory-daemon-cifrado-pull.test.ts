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
    store.bumpUndecryptable(3)
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
