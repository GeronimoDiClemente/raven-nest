import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { isTeamLeader, getTeamKeyState, activateTeamKey, authorizeTeamDevice } from '../src/team-keys'

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

describe('activateTeamKey', () => {
  it('rechaza con 403 a quien no es leader', async () => {
    const res = await activateTeamKey(pool, { deviceId: memberDevice, userId: memberId }, teamId, {
      wraps: [{ slot: memberDevice, kind: 'device', wrapped: 'W' }],
    })
    expect(res).toEqual({ ok: false, status: 403, error: 'leader_required' })
  })

  it('el leader activa: crea team_keys y publica sus envolturas', async () => {
    const res = await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      wraps: [
        { slot: leaderDevice, kind: 'device', wrapped: 'W-LEADER' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'W-REC', wrap_meta: { salt: 'S' } },
      ],
    })
    expect(res).toEqual({ ok: true })
    const { rows } = await pool.query('select activated_by from team_keys where team_id = $1', [teamId])
    expect(rows[0].activated_by).toBe(leaderId)
    const wraps = await pool.query(
      'select slot, kind, wrapped from team_key_wraps where team_id = $1 order by slot', [teamId]
    )
    expect(wraps.rows).toHaveLength(2)
  })

  it('rechaza sin wraps', async () => {
    const res = await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, { wraps: [] })
    expect(res).toEqual({ ok: false, status: 400, error: 'no_wraps' })
  })

  it('un segundo activate sobre un equipo ya activado devuelve 409, no pisa nada', async () => {
    await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      wraps: [{ slot: leaderDevice, kind: 'device', wrapped: 'W-1' }],
    })
    const segundo = await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      wraps: [{ slot: leaderDevice, kind: 'device', wrapped: 'W-2' }],
    })
    expect(segundo).toEqual({ ok: false, status: 409, error: 'already_activated' })
    const { rows } = await pool.query(
      'select wrapped from team_key_wraps where team_id = $1 and slot = $2', [teamId, leaderDevice]
    )
    expect(rows[0].wrapped).toBe('W-1')
  })
})

describe('authorizeTeamDevice', () => {
  beforeEach(async () => {
    await pool.query('insert into team_keys (team_id, activated_by) values ($1, $2)', [teamId, leaderId])
    await pool.query(
      `insert into team_key_wraps (team_id, slot, kind, wrapped) values ($1, $2, 'device', 'W-LEADER')`,
      [teamId, leaderDevice]
    )
  })

  it('rechaza con 403 a quien no es leader', async () => {
    const res = await authorizeTeamDevice(pool, { deviceId: memberDevice, userId: memberId }, teamId, {
      wraps: [{ slot: memberDevice, kind: 'device', wrapped: 'W-MEMBER' }],
    })
    expect(res).toEqual({ ok: false, status: 403, error: 'leader_required' })
  })

  it('rechaza con 404 si el equipo no tiene clave activada', async () => {
    const otroTeam = randomUUID()
    await pool.query(
      `insert into team_memberships (user_id, team_id, team_name, role, status)
       values ($1, $2, 'Otro', 'leader', 'active')`,
      [leaderId, otroTeam]
    )
    const res = await authorizeTeamDevice(pool, { deviceId: leaderDevice, userId: leaderId }, otroTeam, {
      wraps: [{ slot: memberDevice, kind: 'device', wrapped: 'W' }],
    })
    expect(res).toEqual({ ok: false, status: 404, error: 'not_activated' })
  })

  it('el leader autoriza al member: la wrap queda publicada', async () => {
    const res = await authorizeTeamDevice(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      wraps: [{ slot: memberDevice, kind: 'device', wrapped: 'W-MEMBER' }],
    })
    expect(res).toEqual({ ok: true })
    const { rows } = await pool.query(
      'select wrapped from team_key_wraps where team_id = $1 and slot = $2', [teamId, memberDevice]
    )
    expect(rows[0].wrapped).toBe('W-MEMBER')
  })

  it('nunca permite tocar el slot recovery desde authorize', async () => {
    const res = await authorizeTeamDevice(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      wraps: [{ slot: 'recovery', kind: 'recovery', wrapped: 'W-NUEVO' }],
    })
    expect(res).toEqual({ ok: false, status: 400, error: 'cannot_overwrite_recovery' })
  })
})
