// Spec 2b-3: el daemon lista las máquinas de la cuenta (GET /v1/devices) y revoca una por id
// (POST /v1/devices/revoke).
import { describe, it, expect, vi } from 'vitest'
import { MemoryDaemon } from '../memory-daemon'
import type { MemoryStore } from '../memory-store'

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const falla = (status: number, body: unknown) => ({ ok: false, status, json: async () => body })

function daemonCon(
  fetchImpl: ReturnType<typeof vi.fn>,
  extra: { token?: string | null; online?: boolean } = {},
): MemoryDaemon {
  return new MemoryDaemon({
    store: { listProjects: vi.fn(() => []) } as unknown as MemoryStore,
    getSyncBaseUrl: () => 'https://example.test',
    getToken: () => (extra.token === undefined ? 'nmk_test' : extra.token),
    getDeviceId: () => 'device-1',
    isOnline: () => extra.online ?? true,
    fetchImpl,
  } as unknown as ConstructorParameters<typeof MemoryDaemon>[0])
}

describe('MemoryDaemon — máquinas de la cuenta (2b-3)', () => {
  it('listDevices hace GET con Bearer y pasa last_seen_at de ISO a ms (null queda null)', async () => {
    const iso = '2026-10-29T12:00:00.000Z'
    const fetchImpl = vi.fn().mockResolvedValue(ok({ devices: [
      { id: 'd1', name: 'MacBook', platform: 'darwin', last_seen_at: iso, current: true },
      { id: 'd2', name: 'PC', platform: null, last_seen_at: null, current: false },
    ] }))
    const res = await daemonCon(fetchImpl).listDevices()

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://example.test/v1/devices')
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe('Bearer nmk_test')
    expect(res).toEqual({ ok: true, devices: [
      { id: 'd1', name: 'MacBook', platform: 'darwin', lastSeenAt: Date.parse(iso), current: true },
      { id: 'd2', name: 'PC', platform: null, lastSeenAt: null, current: false },
    ] })
  })

  it('listDevices sin token es not_connected y no pide nada', async () => {
    const fetchImpl = vi.fn()
    expect(await daemonCon(fetchImpl, { token: null }).listDevices()).toEqual({ ok: false, error: 'not_connected' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('listDevices offline es offline y no pide nada', async () => {
    const fetchImpl = vi.fn()
    expect(await daemonCon(fetchImpl, { online: false }).listDevices()).toEqual({ ok: false, error: 'offline' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('listDevices con 401 devuelve el código del servidor', async () => {
    const res = await daemonCon(vi.fn().mockResolvedValue(falla(401, { error: 'unauthorized' }))).listDevices()
    expect(res).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('listDevices con un cambio de cuenta en vuelo es account_changed', async () => {
    let responder: (v: unknown) => void = () => {}
    const fetchImpl = vi.fn().mockImplementationOnce(() => new Promise((r) => { responder = r }))
    const daemon = daemonCon(fetchImpl)
    const enVuelo = daemon.listDevices()
    daemon.setStore({ listProjects: vi.fn(() => []) } as unknown as MemoryStore)
    responder(ok({ devices: [] }))
    expect(await enVuelo).toEqual({ ok: false, error: 'account_changed' })
  })

  it('revokeDevice postea el deviceId y devuelve ok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ ok: true, revoked: 1 }))
    expect(await daemonCon(fetchImpl).revokeDevice('d2')).toEqual({ ok: true })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://example.test/v1/devices/revoke')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer nmk_test')
    expect(init.body).toBe('{"deviceId":"d2"}')
  })

  it('revokeDevice con 404 devuelve not_found; con 400 use_self_revoke, el código', async () => {
    expect(await daemonCon(vi.fn().mockResolvedValue(falla(404, { error: 'not_found' }))).revokeDevice('d2'))
      .toEqual({ ok: false, error: 'not_found' })
    expect(await daemonCon(vi.fn().mockResolvedValue(falla(400, { error: 'use_self_revoke' }))).revokeDevice('d1'))
      .toEqual({ ok: false, error: 'use_self_revoke' })
    expect(await daemonCon(vi.fn().mockResolvedValue(falla(500, null))).revokeDevice('d2'))
      .toEqual({ ok: false, error: 'HTTP 500' })
  })

  it('revokeDevice sin token / offline / cuenta cambiada', async () => {
    expect(await daemonCon(vi.fn(), { token: null }).revokeDevice('d2')).toEqual({ ok: false, error: 'not_connected' })
    expect(await daemonCon(vi.fn(), { online: false }).revokeDevice('d2')).toEqual({ ok: false, error: 'offline' })
    let responder: (v: unknown) => void = () => {}
    const daemon = daemonCon(vi.fn().mockImplementationOnce(() => new Promise((r) => { responder = r })))
    const enVuelo = daemon.revokeDevice('d2')
    daemon.setStore({ listProjects: vi.fn(() => []) } as unknown as MemoryStore)
    responder(ok({ ok: true, revoked: 1 }))
    expect(await enVuelo).toEqual({ ok: false, error: 'account_changed' })
  })
})
