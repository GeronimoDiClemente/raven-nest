// Spec 2026-11-02: después de conectar una cuenta nueva, el servidor NUNCA recibe una fila
// personal con texto en claro. Arma lo mismo que `memory:connect`: el daemon ya corriendo
// (con su tick), la memoria local ya escrita, y asegurarCifrado + guardar la maestra.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { MemoryDaemon } from '../memory-daemon'
import { asegurarCifrado } from '../asegurar-cifrado'
import { adoptExistingKey, activateEncryption, fetchKeyState } from '../memory-keys-client'
import { generateDeviceKeyPair, huellaDeClave } from '../memory-key-wrap'
import { deriveKeys } from '../memory-crypto'
import type { EnvelopeContext } from '../memory-envelope'

const SELLABLES = ['title', 'content', 'project_display_name', 'content_hash', 'origin_account', 'git_branch']
const enClaro = (p: Record<string, unknown>) =>
  SELLABLES.some((k) => typeof p[k] === 'string' && p[k] !== '' && !String(p[k]).startsWith('nmc1:'))
  || (Array.isArray(p.tags) && p.tags.length > 0 && !(p.tags.length === 1 && String(p.tags[0]).startsWith('nmc1:')))

let dir: string
let store: MemoryStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nest-conectar-sin-claro-'))
  store = new MemoryStore(join(dir, 'memory.db'))
  store.ensureProject({ projectKey: 'proj1', displayName: 'raven-nest' })
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

/** Un servicio de claves + sync en memoria: lo justo para activar y recibir pushes. */
function servicio() {
  const cuenta = { keyEpoch: 0, wraps: new Map<string, { wrapped: string; wrapMeta: unknown }>(), devices: new Map<string, string>() }
  const subidas: Array<Record<string, unknown>> = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const ok = (j: unknown) => ({ ok: true, status: 200, json: async () => j } as unknown as Response)
    const u = String(url)
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (u.endsWith('/v1/keys/enroll')) { cuenta.devices.set('dev', body.public_key); return ok({ ok: true }) }
    if (u.endsWith('/v1/keys/publish')) {
      if (body.mode === 'activate' && body.key_epoch !== cuenta.keyEpoch + 1) {
        return { ok: false, status: 409, json: async () => ({ error: 'stale_key_epoch' }) } as unknown as Response
      }
      cuenta.keyEpoch = body.key_epoch
      for (const w of body.wraps) cuenta.wraps.set(w.slot, { wrapped: w.wrapped, wrapMeta: w.wrap_meta ?? null })
      return ok({ ok: true, key_epoch: cuenta.keyEpoch })
    }
    if (u.includes('/v1/keys')) {
      return ok({ keyEpoch: cuenta.keyEpoch, wrap: cuenta.wraps.get('dev') ?? null,
        devices: [...cuenta.devices].map(([deviceId, publicKey]) => ({ deviceId, name: 'd', publicKey, hasWrap: cuenta.wraps.has(deviceId) })) })
    }
    if (u.includes('/status')) {
      return ok({ device_id: 'dev', user_id: 'u', plan: 'cloud', next_poll_ms: 300_000,
        quota: { used_bytes: 0, max_bytes: 1_000_000 }, projects: [], key_epoch: cuenta.keyEpoch, plaintext_pending: 0 })
    }
    if (u.includes('/pull')) return ok({ rows: [], cursors: {} })
    for (const m of body.mutations ?? []) subidas.push(m.payload)
    return ok({ results: (body.mutations ?? []).map((m: { sync_id: string }) => ({ sync_id: m.sync_id, outcome: 'applied', project_seq: 1 })) })
  }) as unknown as typeof fetch
  return { fetchImpl, subidas }
}

describe('conectar una cuenta nueva', () => {
  it('ninguna fila personal llega en claro, ni antes ni después de activar', async () => {
    const srv = servicio()
    const device = generateDeviceKeyPair()
    let ctx: EnvelopeContext | null = null
    const daemon = new MemoryDaemon({
      store, getSyncBaseUrl: () => 'http://sync.test', getToken: () => 'tok', getDeviceId: () => 'dev',
      isOnline: () => true, fetchImpl: srv.fetchImpl, getEnvelopeContext: () => ctx,
      isEncryptionExpected: () => store.knownKeyEpoch() > 0, requireEncryption: () => true,
    })

    // La memoria local ya existe y el daemon ya intenta subirla (el tick del arranque).
    store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', title: 'secret plan', content: 'body', source: 'mcp' })
    await daemon.push()
    expect(srv.subidas).toEqual([])

    // memory:connect → asegurarCifrado → guardar la maestra (lo que hace el main).
    const kd = { baseUrl: 'http://sync.test', token: 'tok', deviceId: 'dev', fetchImpl: srv.fetchImpl }
    const r = await asegurarCifrado({
      material: () => ({ device, master: null, keyEpoch: 0 }),
      adoptar: (dv) => adoptExistingKey(kd, dv),
      estadoRemoto: () => fetchKeyState(kd),
      activar: (dv) => activateEncryption(kd, dv),
      huella: huellaDeClave,
    })
    expect(r.estado).toBe('activada')
    if (r.estado !== 'activada') return
    ctx = { keys: deriveKeys(Buffer.from(r.master, 'base64')), keyEpoch: r.keyEpoch }
    store.rememberKeyEpoch(r.keyEpoch)

    store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', title: 'second secret', content: 'more', source: 'mcp' })
    await daemon.push()

    expect(srv.subidas.length).toBeGreaterThan(0)
    expect(srv.subidas.filter(enClaro)).toEqual([])
  })
})
