import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { isTeamLeader, getTeamKeyState } from '../src/team-keys'

const pool = getPool()
let teamId: string, leaderId: string, memberId: string, outsiderId: string
let leaderDevice: string, memberDevice: string

beforeAll(async () => { await migrate(pool) })

beforeEach(async () => {
  teamId = randomUUID()
  leaderId = randomUUID()
  memberId = randomUUID()
  outsiderId = randomUUID()
  leaderDevice = randomUUID()
  memberDevice = randomUUID()
  for (const id of [leaderId, memberId, outsiderId]) {
    await pool.query('insert into users (id) values ($1)', [id])
  }
  await pool.query(
    `insert into team_memberships (user_id, team_id, team_name, role, status)
     values ($1, $2, 'Equipo', 'leader', 'active')`,
    [leaderId, teamId]
  )
  await pool.query(
    `insert into team_memberships (user_id, team_id, team_name, role, status)
     values ($1, $2, 'Equipo', 'member', 'active')`,
    [memberId, teamId]
  )
  for (const [devId, userId, nombre] of [[leaderDevice, leaderId, 'leader-pc'], [memberDevice, memberId, 'member-pc']] as const) {
    await pool.query(
      'insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)',
      [devId, userId, nombre, 'hash-' + devId]
    )
  }
})

describe('isTeamLeader', () => {
  it('es true para el leader activo', async () => {
    expect(await isTeamLeader(pool, leaderId, teamId)).toBe(true)
  })
  it('es false para un member', async () => {
    expect(await isTeamLeader(pool, memberId, teamId)).toBe(false)
  })
  it('es false para alguien sin membresía en ese team', async () => {
    expect(await isTeamLeader(pool, outsiderId, teamId)).toBe(false)
  })
})

describe('getTeamKeyState', () => {
  it('rechaza con 403 a quien no es miembro activo del equipo', async () => {
    const res = await getTeamKeyState(pool, { deviceId: 'x', userId: outsiderId }, teamId)
    expect(res).toEqual({ ok: false, status: 403, error: 'not_a_team_member' })
  })

  it('sin activar: activated=false y sin pendingDevices (nadie publicó public_key aún)', async () => {
    const res = await getTeamKeyState(pool, { deviceId: leaderDevice, userId: leaderId }, teamId)
    expect(res).toEqual({ activated: false, wrap: null, pendingDevices: [] })
  })

  it('lista como pendiente a un device de un miembro con public_key pero sin wrap', async () => {
    await pool.query(
      'insert into device_keys (device_id, user_id, public_key) values ($1, $2, $3)',
      [memberDevice, memberId, 'PUB-MEMBER']
    )
    const res = await getTeamKeyState(pool, { deviceId: leaderDevice, userId: leaderId }, teamId)
    expect(res).toEqual({
      activated: false,
      wrap: null,
      pendingDevices: [{ deviceId: memberDevice, name: 'member-pc', publicKey: 'PUB-MEMBER' }],
    })
  })

  it('una vez activado y con wrap propio, lo devuelve y ya no lista ese device como pendiente', async () => {
    await pool.query(
      'insert into device_keys (device_id, user_id, public_key) values ($1, $2, $3)',
      [leaderDevice, leaderId, 'PUB-LEADER']
    )
    await pool.query('insert into team_keys (team_id, activated_by) values ($1, $2)', [teamId, leaderId])
    await pool.query(
      `insert into team_key_wraps (team_id, slot, kind, wrapped) values ($1, $2, 'device', 'W-LEADER')`,
      [teamId, leaderDevice]
    )
    const res = await getTeamKeyState(pool, { deviceId: leaderDevice, userId: leaderId }, teamId)
    expect(res).toEqual({
      activated: true,
      wrap: { wrapped: 'W-LEADER', wrapMeta: null },
      pendingDevices: [],
    })
  })

  it('con ?slot=recovery devuelve la envoltura de recuperación en vez de la del device', async () => {
    await pool.query('insert into team_keys (team_id, activated_by) values ($1, $2)', [teamId, leaderId])
    await pool.query(
      `insert into team_key_wraps (team_id, slot, kind, wrapped, wrap_meta)
       values ($1, 'recovery', 'recovery', 'W-REC', $2::jsonb)`,
      [teamId, JSON.stringify({ salt: 'S' })]
    )
    const res = await getTeamKeyState(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, 'recovery')
    expect(res).toEqual({
      activated: true,
      wrap: { wrapped: 'W-REC', wrapMeta: { salt: 'S' } },
      pendingDevices: [],
    })
  })
})
