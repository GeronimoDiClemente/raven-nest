// Hueco del 30-oct, lado cliente: el servidor ahora rechaza con `encryption_required` una fila
// personal en claro de una cuenta que cifra (server/src/push.ts). El caso real es una carrera:
// esta máquina vio `key_epoch: 0` en su último status y OTRA activó el cifrado antes del push.
// Si el daemon tratara el motivo como terminal, la memoria no llegaría nunca a la nube.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { MemoryDaemon } from '../memory-daemon'

let dir: string
let store: MemoryStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nest-encryption-required-'))
  store = new MemoryStore(join(dir, 'memory.db'))
  store.ensureProject({ projectKey: 'proj1', displayName: 'raven-nest' })
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

function servidor() {
  const estado = { keyEpoch: 0 }
  const subidas: Array<Record<string, unknown>> = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const ok = (j: unknown) => ({ ok: true, status: 200, json: async () => j } as unknown as Response)
    if (String(url).includes('/status')) {
      return ok({
        device_id: 'dev', user_id: 'u', plan: 'cloud', next_poll_ms: 300_000,
        quota: { used_bytes: 0, max_bytes: 1_000_000 }, projects: [], key_epoch: estado.keyEpoch,
      })
    }
    if (String(url).includes('/pull')) return ok({ rows: [], cursors: {} })
    const body = JSON.parse(String(init?.body ?? '{}')) as { mutations?: Array<{ sync_id: string; payload: Record<string, unknown> }> }
    for (const m of body.mutations ?? []) subidas.push(m.payload)
    return ok({
      results: (body.mutations ?? []).map((m) => estado.keyEpoch > 0
        ? { sync_id: m.sync_id, outcome: 'rejected', project_seq: 0, error: 'encryption_required' }
        : { sync_id: m.sync_id, outcome: 'applied', project_seq: 1 }),
    })
  }) as unknown as typeof fetch
  return { fetchImpl, subidas, estado }
}

function daemon(fetchImpl: typeof fetch) {
  return new MemoryDaemon({
    store, getSyncBaseUrl: () => 'http://sync.test', getToken: () => 'tok', getDeviceId: () => 'dev',
    isOnline: () => true, fetchImpl, getEnvelopeContext: () => null,
    isEncryptionExpected: () => store.knownKeyEpoch() > 0, // el cableado de main.ts
  })
}

describe('encryption_required — claro personal rechazado por una cuenta que cifra', () => {
  it('no se descarta: queda en la cola y el gate personal se arma', async () => {
    const srv = servidor()
    const d = daemon(srv.fetchImpl)
    await d.status() // esta máquina aprende key_epoch 0
    srv.estado.keyEpoch = 1 // otra máquina activa el cifrado

    store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', title: 'nota', content: 'cuerpo', source: 'mcp' })
    await d.push()

    expect(srv.subidas).toHaveLength(1)
    expect(store.pendingMutationCount(), 'la memoria sigue esperando subir, sellada').toBe(1)
    expect(store.blockedMutations()).toEqual([])
    expect(store.knownKeyEpoch()).toBeGreaterThan(0)
  })

  it('el push siguiente no la reenvía en claro: espera la clave (needs_key)', async () => {
    const srv = servidor()
    const d = daemon(srv.fetchImpl)
    await d.status()
    srv.estado.keyEpoch = 1
    store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', title: 'nota', content: 'cuerpo', source: 'mcp' })
    await d.push()

    await d.push()
    expect(srv.subidas, 'una sola subida en claro, la que rechazó el servidor').toHaveLength(1)
    expect(d.getStatus()).toBe('error')
    expect(d.getStatusDetail()).toBe('needs_key')
  })
})
