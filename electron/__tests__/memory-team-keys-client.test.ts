// Test para memory-team-keys-client.ts
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'crypto'
import { generateDeviceKeyPair, wrapForDevice, unwrapWithDevice, wrapForRecovery, generateRecoveryCode } from '../memory-key-wrap'
import { generateMasterKey, teamKeyProof, teamKeyVerifier } from '../memory-crypto'
import {
  fetchTeamKeyState, activateTeamEncryption, adoptExistingTeamKey, authorizeTeamDeviceFromClient, recoverTeamWithCode,
  TeamKeyMismatchError,
} from '../memory-team-keys-client'

interface FilaDb { wrapped: string; kind: string; wrapMeta?: Record<string, unknown> }

/**
 * Imita a server/src/team-keys.ts en lo que importa para C2 (Task 15): `activate` guarda el
 * verificador, el GET lo devuelve, y `authorize` exige la prueba — compara el SHA-256 de lo que
 * le mandan contra el verificador, igual que `pruebaDePosesionValida`.
 */
function servidorFalso() {
  const db = new Map<string, FilaDb>() // key = `${teamId}:${slot}`
  const verificadores = new Map<string, string>()
  const authorizes: Array<{ teamId: string; slot: string }> = []
  const fetchImpl = (vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url)
    const body = init.body ? JSON.parse(String(init.body)) : {}
    if (u.pathname === '/v1/teams/key' && (!init.method || init.method === 'GET')) {
      const teamId = u.searchParams.get('team_id')!
      const slot = u.searchParams.get('slot')
      const activated = verificadores.has(teamId)
      const deviceId = String((init as { headers?: Record<string, string> })?.headers?.['X-Device-Test'] ?? '')
      const fila = db.get(`${teamId}:${slot ?? deviceId}`)
      return new Response(JSON.stringify({
        activated, verifier: verificadores.get(teamId) ?? null,
        wrap: fila ? { wrapped: fila.wrapped, wrapMeta: fila.wrapMeta ?? null } : null, pendingDevices: [],
      }), { status: 200 })
    }
    if (u.pathname === '/v1/teams/key/activate') {
      if (verificadores.has(body.team_id)) {
        return new Response(JSON.stringify({ error: 'already_activated' }), { status: 409 })
      }
      if (typeof body.verifier !== 'string') return new Response(JSON.stringify({ error: 'missing_verifier' }), { status: 400 })
      verificadores.set(body.team_id, body.verifier)
      for (const w of body.wraps) db.set(`${body.team_id}:${w.slot}`, { wrapped: w.wrapped, kind: w.kind, wrapMeta: w.wrap_meta })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    if (u.pathname === '/v1/teams/key/authorize') {
      const esperado = verificadores.get(body.team_id)
      const hash = typeof body.proof === 'string' ? createHash('sha256').update(body.proof, 'utf8').digest('hex') : null
      if (!esperado || hash !== esperado) {
        return new Response(JSON.stringify({ error: 'must_hold_team_key' }), { status: 403 })
      }
      for (const w of body.wraps) {
        db.set(`${body.team_id}:${w.slot}`, { wrapped: w.wrapped, kind: w.kind, wrapMeta: w.wrap_meta })
        authorizes.push({ teamId: body.team_id, slot: w.slot })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    throw new Error(`ruta no mockeada: ${u.pathname}`)
  })) as unknown as typeof fetch
  return { fetchImpl, db, verificadores, authorizes }
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

  it('C2: al activar publica el verificador de ESA maestra y de ESE equipo', async () => {
    const { fetchImpl, verificadores } = servidorFalso()
    const deps = { baseUrl: 'http://x', token: 't', deviceId: 'dev-leader', fetchImpl }
    const { master } = await activateTeamEncryption(deps, 'team-1', generateDeviceKeyPair())
    const m = Buffer.from(master, 'base64')
    expect(verificadores.get('team-1')).toBe(teamKeyVerifier(teamKeyProof(m, 'team-1')))
    // La etiqueta de dominio lleva el team_id: la prueba de un equipo no sirve en otro.
    expect(teamKeyProof(m, 'team-1')).not.toBe(teamKeyProof(m, 'team-2'))
    // Y el verificador no es la prueba: publicarlo no regala lo que el servidor pide.
    expect(teamKeyVerifier(teamKeyProof(m, 'team-1'))).not.toBe(teamKeyProof(m, 'team-1'))
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

  it('C2: autorizar con OTRA maestra no pasa — la prueba no coincide (403)', async () => {
    const { fetchImpl } = servidorFalso()
    const depsLeader = { baseUrl: 'http://x', token: 't', deviceId: 'dev-leader', fetchImpl }
    await activateTeamEncryption(depsLeader, 'team-1', generateDeviceKeyPair())
    const otra = generateMasterKey().toString('base64')
    await expect(authorizeTeamDeviceFromClient(depsLeader, 'team-1', otra, {
      deviceId: 'dev-member', publicKey: generateDeviceKeyPair().publicKey,
    })).rejects.toThrow(/must_hold_team_key/)
  })

  it('C2 ADVERSARIAL: una envoltura con una maestra que no es la del equipo NO se adopta', async () => {
    const { fetchImpl, db } = servidorFalso()
    const deviceMember = generateDeviceKeyPair()
    const depsLeader = { baseUrl: 'http://x', token: 't', deviceId: 'dev-leader', fetchImpl }
    const depsMember = { baseUrl: 'http://x', token: 't', deviceId: 'dev-member', fetchImpl }
    await activateTeamEncryption(depsLeader, 'team-1', generateDeviceKeyPair())
    // Alguien con escritura (un leader sin la clave antes de C2, o la base) planta SU maestra
    // para la pública del member. Sellar no requiere ningún secreto.
    const delAtacante = generateMasterKey()
    db.set('team-1:dev-member', { wrapped: wrapForDevice(deviceMember.publicKey, delAtacante), kind: 'device' })

    await expect(adoptExistingTeamKey(depsMember, 'team-1', deviceMember)).rejects.toBeInstanceOf(TeamKeyMismatchError)
  })

  it('C2: un equipo activado sin verificador no deja adoptar nada (falla cerrado)', async () => {
    const { fetchImpl, db, verificadores } = servidorFalso()
    const deviceMember = generateDeviceKeyPair()
    verificadores.set('team-1', '') // activado, pero sin verificador que comparar
    db.set('team-1:dev-member', { wrapped: wrapForDevice(deviceMember.publicKey, generateMasterKey()), kind: 'device' })
    const depsMember = { baseUrl: 'http://x', token: 't', deviceId: 'dev-member', fetchImpl }
    await expect(adoptExistingTeamKey(depsMember, 'team-1', deviceMember)).rejects.toBeInstanceOf(TeamKeyMismatchError)
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

  it('C2 ADVERSARIAL: una copia de recuperación reemplazada por otra maestra se rechaza ANTES de autorizar', async () => {
    const { fetchImpl, db, authorizes } = servidorFalso()
    const depsLeader = { baseUrl: 'http://x', token: 't', deviceId: 'dev-leader', fetchImpl }
    const depsNuevo = { baseUrl: 'http://x', token: 't', deviceId: 'dev-nuevo', fetchImpl }
    await activateTeamEncryption(depsLeader, 'team-1', generateDeviceKeyPair())
    // La copia de recuperación cambiada por una maestra y un código que el atacante conoce.
    const codigoDelAtacante = generateRecoveryCode()
    const r = wrapForRecovery(codigoDelAtacante, generateMasterKey())
    db.set('team-1:recovery', { wrapped: r.wrapped, kind: 'recovery', wrapMeta: { salt: r.salt } })

    await expect(recoverTeamWithCode(depsNuevo, 'team-1', generateDeviceKeyPair(), codigoDelAtacante))
      .rejects.toBeInstanceOf(TeamKeyMismatchError)
    expect(authorizes).toEqual([])
  })
})
