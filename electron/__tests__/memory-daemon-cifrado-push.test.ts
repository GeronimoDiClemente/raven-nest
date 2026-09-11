import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { MemoryDaemon } from '../memory-daemon'
import { deriveKeys, generateMasterKey, isCiphertext, hmacTopicKey } from '../memory-crypto'
import type { EnvelopeContext } from '../memory-envelope'

const ctx: EnvelopeContext = { keys: deriveKeys(generateMasterKey()), keyEpoch: 1 }

let dir: string
let store: MemoryStore
let enviado: any

function daemonCon(getEnvelopeContext: () => EnvelopeContext | null) {
  enviado = null
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    enviado = JSON.parse(String(init.body))
    return {
      ok: true, status: 200,
      json: async () => ({
        results: enviado.mutations.map((m: any) => ({ sync_id: m.sync_id, outcome: 'applied' })),
      }),
    } as unknown as Response
  }) as unknown as typeof fetch

  return new MemoryDaemon({
    store,
    getSyncBaseUrl: () => 'http://sync.test',
    getToken: () => 'nmk_test',
    getDeviceId: () => 'device-1',
    isOnline: () => true,
    fetchImpl,
    getEnvelopeContext,
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nest-push-cifrado-'))
  store = new MemoryStore(join(dir, 'memory.db'))
  store.ensureProject({ projectKey: 'proj1', displayName: 'raven-nest' })
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

const guardar = (scope: 'personal' | 'team' = 'personal') => store.save({
  projectKey: 'proj1', scope, type: 'decision', topicKey: 'deploy',
  title: 'no notarizar con build.yml', content: 'el DMG sin firmar pisa al firmado',
  tags: ['release'], source: 'mcp',
})

describe('doPush con cifrado', () => {
  it('sin contexto el cuerpo sale igual que hoy', async () => {
    guardar()
    await daemonCon(() => null).push()
    const p = enviado.mutations[0].payload
    expect(p.title).toBe('no notarizar con build.yml')
    expect(p.topic_key).toBe('deploy')
  })

  it('con contexto, el cuerpo que sale a la red no tiene texto legible', async () => {
    guardar()
    await daemonCon(() => ctx).push()
    const p = enviado.mutations[0].payload
    expect(isCiphertext(p.title)).toBe(true)
    expect(isCiphertext(p.content)).toBe(true)
    expect(isCiphertext(p.project_display_name)).toBe(true)
    expect(p.topic_key).toBe(hmacTopicKey(ctx.keys, 'proj1', 'personal', 'deploy'))
    // El chequeo que de verdad importa: NADA del texto original aparece en el body entero.
    const crudo = JSON.stringify(enviado)
    expect(crudo).not.toContain('no notarizar')
    expect(crudo).not.toContain('DMG sin firmar')
    expect(crudo).not.toContain('raven-nest')
    expect(crudo).not.toContain('deploy')
  })

  it('lo que queda en claro sigue en claro', async () => {
    guardar()
    await daemonCon(() => ctx).push()
    const p = enviado.mutations[0].payload
    expect(p.project_key).toBe('proj1')
    expect(p.scope).toBe('personal')
    expect(p.type).toBe('decision')
    expect(typeof p.lamport).toBe('number')
  })

  it('una observación de equipo sale en claro (decisión 1 del §9)', async () => {
    guardar('team')
    await daemonCon(() => ctx).push()
    expect(enviado.mutations[0].payload.title).toBe('no notarizar con build.yml')
  })

  it('el sellado NO cambia el mutation_log: lo encolado queda en claro', async () => {
    guardar()
    await daemonCon(() => ctx).push()
    // La cola local es la copia del usuario y vive en su maquina, que la spec §5.1 deja
    // fuera del modelo de amenaza. Cifrarla romperia un reintento con otra clave.
    const filas = store.blockedMutations()
    expect(filas).toEqual([])
    expect(store.pendingMutationCount()).toBe(0)
  })

  it('el ack por sync_id sigue funcionando: el sync_id no se cifra', async () => {
    const { syncId } = guardar()
    await daemonCon(() => ctx).push()
    expect(enviado.mutations[0].payload.sync_id).toBe(syncId)
    expect(store.pendingMutationCount()).toBe(0)
  })
})
