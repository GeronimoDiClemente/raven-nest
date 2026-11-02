// Spec 2026-11-02 §2: con `requireEncryption`, sin maestra no sale NADA — tampoco por el
// tick del intervalo, que corre desde el arranque y puede adelantarse al connect.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { MemoryDaemon } from '../memory-daemon'
import { deriveKeys, generateMasterKey } from '../memory-crypto'
import type { EnvelopeContext } from '../memory-envelope'

let dir: string
let store: MemoryStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nest-require-enc-'))
  store = new MemoryStore(join(dir, 'memory.db'))
  store.ensureProject({ projectKey: 'proj1', displayName: 'raven-nest' })
})
afterEach(() => { vi.useRealTimers(); store.close(); rmSync(dir, { recursive: true, force: true }) })

function servidor(keyEpoch: number, plaintextPending = 0) {
  const subidas: Array<Record<string, unknown>> = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const ok = (j: unknown) => ({ ok: true, status: 200, json: async () => j } as unknown as Response)
    if (String(url).includes('/status')) {
      return ok({ device_id: 'dev', user_id: 'u', plan: 'cloud', next_poll_ms: 300_000,
        quota: { used_bytes: 0, max_bytes: 1_000_000 }, projects: [], key_epoch: keyEpoch, plaintext_pending: plaintextPending })
    }
    if (String(url).includes('/pull')) return ok({ rows: [], cursors: {} })
    const body = JSON.parse(String(init?.body ?? '{}')) as { mutations?: Array<{ sync_id: string; payload: Record<string, unknown> }> }
    for (const m of body.mutations ?? []) subidas.push(m.payload)
    return ok({ results: (body.mutations ?? []).map((m) => ({ sync_id: m.sync_id, outcome: 'applied', project_seq: 1 })) })
  }) as unknown as typeof fetch
  return { fetchImpl, subidas }
}

function daemon(fetchImpl: typeof fetch, ctx: () => EnvelopeContext | null, extra: Record<string, unknown> = {}) {
  return new MemoryDaemon({
    store, getSyncBaseUrl: () => 'http://sync.test', getToken: () => 'tok', getDeviceId: () => 'dev',
    isOnline: () => true, fetchImpl, getEnvelopeContext: ctx,
    isEncryptionExpected: () => store.knownKeyEpoch() > 0,
    requireEncryption: () => true,
    ...extra,
  })
}
const guardar = () => store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', title: 'secret', content: 'body', source: 'mcp' })

describe('requireEncryption', () => {
  it('época 0 y sin maestra: no sale nada y el estado es needs_encryption_setup', async () => {
    guardar()
    const srv = servidor(0)
    const d = daemon(srv.fetchImpl, () => null)
    await d.push()
    expect(srv.subidas).toEqual([])
    expect(d.getStatus()).toBe('error')
    expect(d.getStatusDetail()).toBe('needs_encryption_setup')
    expect(store.pendingMutationCount()).toBe(1)
  })

  it('época > 0 y sin maestra: needs_key, como antes', async () => {
    guardar()
    const srv = servidor(2)
    const d = daemon(srv.fetchImpl, () => null)
    await d.push()
    expect(srv.subidas).toEqual([])
    expect(d.getStatusDetail()).toBe('needs_key')
  })

  it('el tick del intervalo tampoco sube sin maestra', async () => {
    vi.useFakeTimers()
    guardar()
    const srv = servidor(0)
    const d = daemon(srv.fetchImpl, () => null)
    d.start()
    await vi.advanceTimersByTimeAsync(16 * 60_000)
    d.stop()
    expect(srv.subidas).toEqual([])
  })

  it('con la maestra sale SELLADO', async () => {
    guardar()
    const srv = servidor(1)
    const ctx: EnvelopeContext = { keys: deriveKeys(generateMasterKey()), keyEpoch: 1 }
    await daemon(srv.fetchImpl, () => ctx).push()
    expect(srv.subidas).toHaveLength(1)
    expect(String(srv.subidas[0].title).startsWith('nmc1:')).toBe(true)
  })

  it('sin requireEncryption (callers viejos) el comportamiento no cambia', async () => {
    guardar()
    const srv = servidor(0)
    await daemon(srv.fetchImpl, () => null, { requireEncryption: undefined }).push()
    expect(srv.subidas).toHaveLength(1)
  })
})

describe('plaintext_pending', () => {
  it('se guarda del status y avisa cuando es > 0', async () => {
    const avisos: number[] = []
    const d = daemon(servidor(1, 7).fetchImpl, () => null, { onPlaintextPending: (n: number) => avisos.push(n) })
    expect(d.getPlaintextPending()).toBeNull()
    await d.status()
    expect(d.getPlaintextPending()).toBe(7)
    expect(avisos).toEqual([7])
  })

  it('con 0 no avisa', async () => {
    const avisos: number[] = []
    const d = daemon(servidor(1, 0).fetchImpl, () => null, { onPlaintextPending: (n: number) => avisos.push(n) })
    await d.status()
    expect(d.getPlaintextPending()).toBe(0)
    expect(avisos).toEqual([])
  })
})
