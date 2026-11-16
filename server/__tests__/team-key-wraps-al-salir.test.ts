// Opción A de `docs/superpowers/specs/2026-11-09-rotacion-clave-equipo-design.md` (§1.1, §2.2.3,
// §2.3): salir del equipo, o revocar una máquina, tiene que borrar las envolturas de la maestra
// de equipo selladas para esas máquinas. Sin eso, un dump de la base + el privado que el
// ex-miembro conserva en su disco = la maestra, y al volver a entrar la readopta sola sin que el
// leader autorice nada. NECESITA POSTGRES, como el resto de server/.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { registerDevice, revokeDevices } from '../src/devices'
import { aplicarMembresias } from '../src/membership-sync'
import { getTeamKeyState } from '../src/team-keys'

const pool = getPool()
const ENV_ANTES = { ...process.env }
const FETCH_ANTES = global.fetch

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })
afterEach(() => {
  process.env = { ...ENV_ANTES }
  global.fetch = FETCH_ANTES
})

async function usuario(): Promise<string> {
  const id = randomUUID()
  await pool.query('insert into users (id, plan) values ($1, $2)', [id, 'cloud'])
  await pool.query('insert into allowlist (user_id) values ($1)', [id])
  return id
}

async function maquina(userId: string): Promise<{ deviceId: string; token: string }> {
  const r = await registerDevice(pool, { userId, email: null }, { name: 'Mac' })
  if (!r.ok) throw new Error('el registro falló, el test no puede seguir')
  await pool.query('insert into device_keys (device_id, user_id, public_key) values ($1, $2, $3)', [
    r.deviceId, userId, 'PUB-' + r.deviceId,
  ])
  return { deviceId: r.deviceId, token: r.token }
}

/** Un equipo activado por `leaderId`, con la envoltura de recuperación y una por cada slot. */
async function equipoCifrado(leaderId: string, slots: string[]): Promise<string> {
  const teamId = randomUUID()
  await pool.query('insert into team_keys (team_id, activated_by, verifier) values ($1, $2, $3)', [teamId, leaderId, 'V'])
  await pool.query(
    `insert into team_key_wraps (team_id, slot, kind, wrapped) values ($1, 'recovery', 'recovery', 'W-REC')`,
    [teamId]
  )
  for (const slot of slots) {
    await pool.query(
      `insert into team_key_wraps (team_id, slot, kind, wrapped) values ($1, $2, 'device', $3)`,
      [teamId, slot, 'W-' + slot]
    )
  }
  return teamId
}

async function slots(teamId: string): Promise<string[]> {
  const { rows } = await pool.query('select slot from team_key_wraps where team_id = $1 order by slot', [teamId])
  return rows.map((r) => r.slot as string)
}

const ordenados = (...xs: string[]) => [...xs].sort()

describe('aviso de membresías: salir del equipo borra sus envolturas', () => {
  it('borra las de TODAS sus máquinas en el equipo que perdió; las del resto y la de recuperación quedan', async () => {
    const leader = await usuario()
    const miembro = await usuario()
    const lider1 = await maquina(leader)
    const m1 = await maquina(miembro)
    const m2 = await maquina(miembro)
    const equipo = await equipoCifrado(leader, [lider1.deviceId, m1.deviceId, m2.deviceId])
    await aplicarMembresias(pool, { userId: miembro, asOf: 1000, memberships: [{ teamId: equipo, teamName: 'E', role: 'member' }] })

    expect(await aplicarMembresias(pool, { userId: miembro, asOf: 2000, memberships: [] })).toBe(true)

    expect(await slots(equipo)).toEqual(ordenados('recovery', lider1.deviceId))
  })

  it('no toca las envolturas de los equipos en los que sigue', async () => {
    const leader = await usuario()
    const miembro = await usuario()
    const m1 = await maquina(miembro)
    const sigue = await equipoCifrado(leader, [m1.deviceId])
    const pierde = await equipoCifrado(leader, [m1.deviceId])

    await aplicarMembresias(pool, { userId: miembro, asOf: 1000, memberships: [{ teamId: sigue, teamName: 'S', role: 'member' }] })

    expect(await slots(sigue)).toEqual(ordenados('recovery', m1.deviceId))
    expect(await slots(pierde)).toEqual(['recovery'])
  })

  it('borra aunque el espejo ya no lo tuviera (lo sacaron antes de que existiera este borrado)', async () => {
    const leader = await usuario()
    const miembro = await usuario()
    const m1 = await maquina(miembro)
    const equipo = await equipoCifrado(leader, [m1.deviceId])
    // Sin ninguna membresía previa en el espejo: el aviso vacío igual tiene que limpiar.
    await aplicarMembresias(pool, { userId: miembro, asOf: 1000, memberships: [] })
    expect(await slots(equipo)).toEqual(['recovery'])
  })

  it('un aviso VIEJO (ignorado) no borra nada', async () => {
    const leader = await usuario()
    const miembro = await usuario()
    const m1 = await maquina(miembro)
    const equipo = await equipoCifrado(leader, [m1.deviceId])
    const membresia = [{ teamId: equipo, teamName: 'E', role: 'member' }]
    await aplicarMembresias(pool, { userId: miembro, asOf: 3000, memberships: membresia })

    expect(await aplicarMembresias(pool, { userId: miembro, asOf: 2000, memberships: [] })).toBe(false)

    expect(await slots(equipo)).toEqual(ordenados('recovery', m1.deviceId))
  })

  it('al volver a entrar, su máquina aparece pendiente para el leader y sin envoltura', async () => {
    const leader = await usuario()
    const miembro = await usuario()
    const lider1 = await maquina(leader)
    const m1 = await maquina(miembro)
    const equipo = await equipoCifrado(leader, [lider1.deviceId, m1.deviceId])
    const membresia = [{ teamId: equipo, teamName: 'E', role: 'member' }]
    await pool.query(
      `insert into team_memberships (user_id, team_id, team_name, role, status) values ($1, $2, 'E', 'leader', 'active')`,
      [leader, equipo]
    )
    await aplicarMembresias(pool, { userId: miembro, asOf: 1000, memberships: membresia })
    await aplicarMembresias(pool, { userId: miembro, asOf: 2000, memberships: [] })
    await aplicarMembresias(pool, { userId: miembro, asOf: 3000, memberships: membresia })

    const delMiembro = await getTeamKeyState(pool, { deviceId: m1.deviceId, userId: miembro }, equipo)
    expect(delMiembro).toMatchObject({ activated: true, wrap: null })
    const delLeader = await getTeamKeyState(pool, { deviceId: lider1.deviceId, userId: leader }, equipo)
    expect('pendingDevices' in delLeader && delLeader.pendingDevices.map((d) => d.deviceId)).toEqual([m1.deviceId])
  })
})

describe('registro de máquina: el set de Supabase sin un equipo también borra', () => {
  it('borra las envolturas del equipo que ya no viene, en todas sus máquinas', async () => {
    const leader = await usuario()
    const miembro = await usuario()
    const m1 = await maquina(miembro)
    const equipo = await equipoCifrado(leader, [m1.deviceId])
    process.env.SUPABASE_URL = 'https://ejemplo.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-key-de-prueba'
    global.fetch = vi.fn(async () =>
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    ) as unknown as typeof fetch

    const r = await registerDevice(pool, { userId: miembro, email: null }, { name: 'PC' }, 'jwt')

    expect(r.ok).toBe(true)
    expect(await slots(equipo)).toEqual(['recovery'])
  })

  it('si Supabase falla no borra nada', async () => {
    const leader = await usuario()
    const miembro = await usuario()
    const m1 = await maquina(miembro)
    const equipo = await equipoCifrado(leader, [m1.deviceId])
    process.env.SUPABASE_URL = 'https://ejemplo.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-key-de-prueba'
    global.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch

    await registerDevice(pool, { userId: miembro, email: null }, { name: 'PC' }, 'jwt')

    expect(await slots(equipo)).toEqual(ordenados('recovery', m1.deviceId))
  })
})

describe('revocar una máquina borra sus envolturas de equipo', () => {
  it('la propia', async () => {
    const leader = await usuario()
    const miembro = await usuario()
    const m1 = await maquina(miembro)
    const m2 = await maquina(miembro)
    const equipo = await equipoCifrado(leader, [m1.deviceId, m2.deviceId])

    expect(await revokeDevices(pool, m1.token)).toEqual({ ok: true, revoked: 1 })

    expect(await slots(equipo)).toEqual(ordenados('recovery', m2.deviceId))
  })

  it('otra de la cuenta, por id', async () => {
    const leader = await usuario()
    const miembro = await usuario()
    const m1 = await maquina(miembro)
    const m2 = await maquina(miembro)
    const equipo = await equipoCifrado(leader, [m1.deviceId, m2.deviceId])

    expect(await revokeDevices(pool, m1.token, { deviceId: m2.deviceId })).toEqual({ ok: true, revoked: 1 })

    expect(await slots(equipo)).toEqual(ordenados('recovery', m1.deviceId))
  })

  it('todas, en todos los equipos; las de otra cuenta quedan', async () => {
    const leader = await usuario()
    const miembro = await usuario()
    const lider1 = await maquina(leader)
    const m1 = await maquina(miembro)
    const m2 = await maquina(miembro)
    const a = await equipoCifrado(leader, [lider1.deviceId, m1.deviceId])
    const b = await equipoCifrado(leader, [m2.deviceId])

    expect(await revokeDevices(pool, m1.token, { all: true })).toEqual({ ok: true, revoked: 2 })

    expect(await slots(a)).toEqual(ordenados('recovery', lider1.deviceId))
    expect(await slots(b)).toEqual(['recovery'])
  })

  it('un id que no es de la cuenta (404) no borra nada', async () => {
    const leader = await usuario()
    const miembro = await usuario()
    const otro = await usuario()
    const m1 = await maquina(miembro)
    const ajena = await maquina(otro)
    const equipo = await equipoCifrado(leader, [ajena.deviceId])

    expect(await revokeDevices(pool, m1.token, { deviceId: ajena.deviceId })).toMatchObject({ ok: false, status: 404 })

    expect(await slots(equipo)).toEqual(ordenados('recovery', ajena.deviceId))
  })
})
