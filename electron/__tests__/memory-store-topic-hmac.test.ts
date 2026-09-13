import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore, SCHEMA_VERSION, type TopicHasher } from '../memory-store'

// Hasher de juguete: determinístico y legible en un assert, que es todo lo que el store
// necesita saber de él.
const hasher: TopicHasher = (p, s, t) => `H(${p}|${s}|${t})`

let dir: string
let store: MemoryStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nest-store-hmac-'))
  store = new MemoryStore(join(dir, 'memory.db'))
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

const guardar = (topicKey: string | null, title = 't') => store.save({
  projectKey: 'proj1', scope: 'personal', type: 'decision', topicKey,
  title, content: 'body', source: 'mcp',
})

describe('memory-store — topic_key_hmac', () => {
  // El plan numeraba esta migracion como la 4; va en la 6 porque `memory_links` ya se
  // llevo la 5 en esta rama.
  //
  // El pin exacto de `SCHEMA_VERSION` vive en UN solo lugar (`memory-store.test.ts`): tenerlo
  // dos veces no agrega cobertura y hace que cada migracion nueva rompa un test que no tiene
  // nada que ver con ella. Lo que a este archivo le importa es que la migracion del HMAC ya
  // corrio, no cual es el numero de hoy.
  it('la base pasó por la migración del HMAC', () => {
    expect(store.schemaVersion).toBe(SCHEMA_VERSION)
    expect(store.schemaVersion).toBeGreaterThanOrEqual(6)
  })

  it('sin hasher el HMAC queda null y nada cambia', () => {
    const { syncId } = guardar('deploy')
    expect(store.get(syncId)!.topic_key_hmac).toBeNull()
  })

  it('con hasher, save() escribe el HMAC junto al tema en claro', () => {
    store.setTopicHasher(hasher)
    const { syncId } = guardar('deploy')
    const row = store.get(syncId)!
    expect(row.topic_key).toBe('deploy')
    expect(row.topic_key_hmac).toBe('H(proj1|personal|deploy)')
  })

  it('una observación sin tema no tiene HMAC', () => {
    store.setTopicHasher(hasher)
    const { syncId } = guardar(null)
    expect(store.get(syncId)!.topic_key_hmac).toBeNull()
  })

  it('findActiveTopicOwnerByHmac encuentra al dueño del slot', () => {
    store.setTopicHasher(hasher)
    const { syncId } = guardar('deploy')
    const owner = store.findActiveTopicOwnerByHmac('proj1', 'personal', 'H(proj1|personal|deploy)', 'otro')
    expect(owner?.sync_id).toBe(syncId)
  })

  it('excluye la propia fila y no cruza proyecto ni scope', () => {
    store.setTopicHasher(hasher)
    const { syncId } = guardar('deploy')
    expect(store.findActiveTopicOwnerByHmac('proj1', 'personal', 'H(proj1|personal|deploy)', syncId)).toBeNull()
    expect(store.findActiveTopicOwnerByHmac('proj2', 'personal', 'H(proj1|personal|deploy)', 'otro')).toBeNull()
    expect(store.findActiveTopicOwnerByHmac('proj1', 'team', 'H(proj1|personal|deploy)', 'otro')).toBeNull()
  })

  it('no devuelve filas borradas ni superseded', () => {
    store.setTopicHasher(hasher)
    const { syncId } = guardar('deploy')
    store.deleteObservation(syncId)
    expect(store.findActiveTopicOwnerByHmac('proj1', 'personal', 'H(proj1|personal|deploy)', 'otro')).toBeNull()
  })

  it('applyIncomingObservation guarda el HMAC que le pasan tal cual', () => {
    store.setTopicHasher(hasher)
    store.applyIncomingObservation({
      syncId: 'obs_remoto', projectKey: 'proj1', scope: 'personal', topicKey: null,
      topicKeyHmac: 'H-DEL-SERVIDOR', type: 'decision', title: 'x', content: 'y',
      updatedAt: Date.now(), lamport: 5, deleted: false,
    })
    const row = store.get('obs_remoto')!
    // El tema en claro NO se puede reconstruir de un HMAC: queda null, y es correcto.
    expect(row.topic_key).toBeNull()
    expect(row.topic_key_hmac).toBe('H-DEL-SERVIDOR')
    expect(store.findActiveTopicOwnerByHmac('proj1', 'personal', 'H-DEL-SERVIDOR', 'otro')?.sync_id)
      .toBe('obs_remoto')
  })

  // El caso de la activacion: hay 866 filas guardadas ANTES de que existiera una clave.
  it('backfillTopicHmacs completa las filas viejas y no toca las que ya tienen', () => {
    const a = guardar('deploy', 'a').syncId
    const b = guardar('release', 'b').syncId
    const c = guardar(null, 'c').syncId
    expect(store.get(a)!.topic_key_hmac).toBeNull()

    store.setTopicHasher(hasher)
    expect(store.backfillTopicHmacs()).toBe(2)
    expect(store.get(a)!.topic_key_hmac).toBe('H(proj1|personal|deploy)')
    expect(store.get(b)!.topic_key_hmac).toBe('H(proj1|personal|release)')
    expect(store.get(c)!.topic_key_hmac).toBeNull()

    // Idempotente: correrlo de nuevo no reescribe nada.
    expect(store.backfillTopicHmacs()).toBe(0)
  })

  it('backfillTopicHmacs sin hasher es un no-op, no una excepción', () => {
    guardar('deploy')
    expect(store.backfillTopicHmacs()).toBe(0)
  })
})
