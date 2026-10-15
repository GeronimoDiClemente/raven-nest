// Test para memory-team-keys-client.ts
import { describe, it, expect, vi } from 'vitest'
import { generateDeviceKeyPair, wrapForDevice, unwrapWithDevice } from '../memory-key-wrap'
import {
  fetchTeamKeyState, activateTeamEncryption, adoptExistingTeamKey, authorizeTeamDeviceFromClient, recoverTeamWithCode,
} from '../memory-team-keys-client'

interface FilaDb { wrapped: string; kind: string; wrapMeta?: Record<string, unknown> }

function servidorFalso() {
  const db = new Map<string, FilaDb>() // key = `${teamId}:${slot}`
  const publicKeys = new Map<string, string>() // deviceId -> publicKey
  const fetchImpl = (vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url)
    const body = init.body ? JSON.parse(String(init.body)) : {}
    if (u.pathname === '/v1/teams/key' && (!init.method || init.method === 'GET')) {
      const teamId = u.searchParams.get('team_id')!
      const slot = u.searchParams.get('slot')
      const activated = [...db.keys()].some((k) => k.startsWith(`${teamId}:`))
      const deviceId = String((init as { headers?: Record<string, string> })?.headers?.['X-Device-Test'] ?? '')
      const fila = db.get(`${teamId}:${slot ?? deviceId}`)
      return new Response(JSON.stringify({
        activated, wrap: fila ? { wrapped: fila.wrapped, wrapMeta: fila.wrapMeta ?? null } : null, pendingDevices: [],
      }), { status: 200 })
    }
    if (u.pathname === '/v1/teams/key/activate') {
      if ([...db.keys()].some((k) => k.startsWith(`${body.team_id}:`))) {
        return new Response(JSON.stringify({ error: 'already_activated' }), { status: 409 })
      }
      for (const w of body.wraps) db.set(`${body.team_id}:${w.slot}`, { wrapped: w.wrapped, kind: w.kind, wrapMeta: w.wrap_meta })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    if (u.pathname === '/v1/teams/key/authorize') {
      for (const w of body.wraps) db.set(`${body.team_id}:${w.slot}`, { wrapped: w.wrapped, kind: w.kind, wrapMeta: w.wrap_meta })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    throw new Error(`ruta no mockeada: ${u.pathname}`)
  })) as unknown as typeof fetch
  return { fetchImpl, publicKeys }
}

describe('memory-team-keys-client', () => {
  it('activa, y el mismo leader lee su propia wrap después', async () => {
    const { fetchImpl } = servidorFalso()
    const device = generateDeviceKeyPair()
    const deps = { baseUrl: 'http://x', token: 't', deviceId: 'dev-leader', fetchImpl }
    const { master, recoveryCode } = await activateTeamEncryption(deps, 'team-1', device)
    expect(master).toBeTruthy()
    expect(recoveryCode).toMatch(/^[0-9A-Z-]+$/)

    const estado = await fetchTeamKeyState(deps, 'team-1')
    expect(estado.activated).toBe(true)
    expect(unwrapWithDevice(device.privateKey, estado.wrap!.wrapped).toString('base64')).toBe(master)
  })

  it('adoptExistingTeamKey da null si el equipo todavía no se activó', async () => {
    const { fetchImpl } = servidorFalso()
    const device = generateDeviceKeyPair()
    const deps = { baseUrl: 'http://x', token: 't', deviceId: 'dev-member', fetchImpl }
    expect(await adoptExistingTeamKey(deps, 'team-1', device)).toBeNull()
  })

  it('el leader autoriza al member y éste adopta la MISMA maestra', async () => {
    const { fetchImpl } = servidorFalso()
    const deviceLeader = generateDeviceKeyPair()
    const deviceMember = generateDeviceKeyPair()
    const depsLeader = { baseUrl: 'http://x', token: 't', deviceId: 'dev-leader', fetchImpl }
    const depsMember = { baseUrl: 'http://x', token: 't', deviceId: 'dev-member', fetchImpl }

    const { master } = await activateTeamEncryption(depsLeader, 'team-1', deviceLeader)
    await authorizeTeamDeviceFromClient(depsLeader, 'team-1', master, {
      deviceId: 'dev-member', publicKey: deviceMember.publicKey,
    })
    const adoptado = await adoptExistingTeamKey(depsMember, 'team-1', deviceMember)
    expect(adoptado?.master).toBe(master)
  })

  it('recupera con el código y se auto-autoriza para no volver a pedirlo', async () => {
    const { fetchImpl } = servidorFalso()
    const deviceLeader = generateDeviceKeyPair()
    const deviceNuevo = generateDeviceKeyPair()
    const depsLeader = { baseUrl: 'http://x', token: 't', deviceId: 'dev-leader', fetchImpl }
    const depsNuevo = { baseUrl: 'http://x', token: 't', deviceId: 'dev-nuevo', fetchImpl }

    const { master, recoveryCode } = await activateTeamEncryption(depsLeader, 'team-1', deviceLeader)
    const recuperado = await recoverTeamWithCode(depsNuevo, 'team-1', deviceNuevo, recoveryCode)
    expect(recuperado.master).toBe(master)

    // Se auto-autorizó: una segunda lectura, sin volver a recuperar, ya tiene wrap propia.
    const adoptado = await adoptExistingTeamKey(depsNuevo, 'team-1', deviceNuevo)
    expect(adoptado?.master).toBe(master)
  })

  it('un código equivocado tira ANTES de publicar nada', async () => {
    const { fetchImpl } = servidorFalso()
    const deviceLeader = generateDeviceKeyPair()
    const deviceNuevo = generateDeviceKeyPair()
    const depsLeader = { baseUrl: 'http://x', token: 't', deviceId: 'dev-leader', fetchImpl }
    const depsNuevo = { baseUrl: 'http://x', token: 't', deviceId: 'dev-nuevo', fetchImpl }
    await activateTeamEncryption(depsLeader, 'team-1', deviceLeader)

    await expect(
      recoverTeamWithCode(depsNuevo, 'team-1', deviceNuevo, '0000-0000-0000-0000-0000-0000')
    ).rejects.toThrow()
    expect(await adoptExistingTeamKey(depsNuevo, 'team-1', deviceNuevo)).toBeNull()
  })
})
