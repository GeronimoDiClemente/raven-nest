import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { isTeamLeader, getTeamKeyState, activateTeamKey, authorizeTeamDevice } from '../src/team-keys'
import { enrollDeviceKey } from '../src/keys'
import { handleStatus } from '../src/status'

const pool = getPool()
let teamId: string, leaderId: string, memberId: string, outsiderId: string
let leaderDevice: string, memberDevice: string

// Task 15 (C2): el servidor guarda el SHA-256 de la prueba, nunca la prueba. Lo que el cliente
// deriva de la maestra (`teamKeyProof`) acá es un string cualquiera: el servidor no puede
// derivarlo, sólo comparar su hash contra el verificador guardado al activar.
const PRUEBA = 'prueba-derivada-de-la-maestra-de-equipo'
const VERIFICADOR = createHash('sha256').update(PRUEBA, 'utf8').digest('hex')

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

const activacionValida = () => ({
  verifier: VERIFICADOR,
  wraps: [
    { slot: leaderDevice, kind: 'device', wrapped: 'W-LEADER' },
    { slot: 'recovery', kind: 'recovery', wrapped: 'W-REC', wrap_meta: { salt: 'S' } },
  ],
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

  it('sin activar: activated=false, sin verificador y sin pendingDevices (nadie publicó public_key aún)', async () => {
    const res = await getTeamKeyState(pool, { deviceId: leaderDevice, userId: leaderId }, teamId)
    expect(res).toEqual({ activated: false, verifier: null, wrap: null, pendingDevices: [] })
  })

  it('lista como pendiente a un device de un miembro con public_key pero sin wrap', async () => {
    await pool.query(
      'insert into device_keys (device_id, user_id, public_key) values ($1, $2, $3)',
      [memberDevice, memberId, 'PUB-MEMBER']
    )
    const res = await getTeamKeyState(pool, { deviceId: leaderDevice, userId: leaderId }, teamId)
    expect(res).toEqual({
      activated: false,
      verifier: null,
      wrap: null,
      pendingDevices: [{ deviceId: memberDevice, name: 'member-pc', publicKey: 'PUB-MEMBER' }],
    })
  })

  it('una vez activado devuelve wrap propio y el verificador, y ya no lista ese device como pendiente', async () => {
    await pool.query(
      'insert into device_keys (device_id, user_id, public_key) values ($1, $2, $3)',
      [leaderDevice, leaderId, 'PUB-LEADER']
    )
    await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, activacionValida())
    const res = await getTeamKeyState(pool, { deviceId: leaderDevice, userId: leaderId }, teamId)
    expect(res).toEqual({
      activated: true,
      verifier: VERIFICADOR,
      wrap: { wrapped: 'W-LEADER', wrapMeta: null },
      pendingDevices: [],
    })
  })

  it('un member también ve el verificador: es lo que le deja comprobar la maestra que adopta', async () => {
    await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, activacionValida())
    const res = await getTeamKeyState(pool, { deviceId: memberDevice, userId: memberId }, teamId)
    expect('ok' in res).toBe(false)
    if (!('ok' in res)) expect(res.verifier).toBe(VERIFICADOR)
  })

  it('con ?slot=recovery devuelve la envoltura de recuperación en vez de la del device', async () => {
    await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, activacionValida())
    const res = await getTeamKeyState(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, 'recovery')
    expect(res).toEqual({
      activated: true,
      verifier: VERIFICADOR,
      wrap: { wrapped: 'W-REC', wrapMeta: { salt: 'S' } },
      pendingDevices: [],
    })
  })
})

describe('activateTeamKey', () => {
  it('rechaza con 403 a quien no es leader', async () => {
    const res = await activateTeamKey(pool, { deviceId: memberDevice, userId: memberId }, teamId, {
      verifier: VERIFICADOR,
      wraps: [
        { slot: memberDevice, kind: 'device', wrapped: 'W' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'W-REC', wrap_meta: { salt: 'S' } },
      ],
    })
    expect(res).toEqual({ ok: false, status: 403, error: 'leader_required' })
  })

  it('el leader activa: crea team_keys con el verificador y publica sus envolturas', async () => {
    const res = await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, activacionValida())
    expect(res).toEqual({ ok: true })
    const { rows } = await pool.query('select activated_by, verifier from team_keys where team_id = $1', [teamId])
    expect(rows[0].activated_by).toBe(leaderId)
    expect(rows[0].verifier).toBe(VERIFICADOR)
    const wraps = await pool.query(
      'select slot, kind, wrapped from team_key_wraps where team_id = $1 order by slot', [teamId]
    )
    expect(wraps.rows).toHaveLength(2)
  })

  it('rechaza sin wraps', async () => {
    const res = await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, { verifier: VERIFICADOR, wraps: [] })
    expect(res).toEqual({ ok: false, status: 400, error: 'no_wraps' })
  })

  it('C2: rechaza sin verificador — un equipo sin él no podría volver a autorizar ni migrar nunca', async () => {
    const { verifier: _v, ...sinVerificador } = activacionValida()
    const res = await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, sinVerificador)
    expect(res).toEqual({ ok: false, status: 400, error: 'missing_verifier' })
    expect((await pool.query('select 1 from team_keys where team_id = $1', [teamId])).rows).toHaveLength(0)
  })

  it('rechaza sin slot de recuperación', async () => {
    const res = await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      verifier: VERIFICADOR, wraps: [{ slot: leaderDevice, kind: 'device', wrapped: 'W' }],
    })
    expect(res).toEqual({ ok: false, status: 400, error: 'missing_recovery' })
  })

  it('rechaza un slot de device que no es el del device que activa', async () => {
    const res = await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      verifier: VERIFICADOR,
      wraps: [
        { slot: memberDevice, kind: 'device', wrapped: 'W-PLANTADA' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'W-REC', wrap_meta: { salt: 'S' } },
      ],
    })
    expect(res).toEqual({ ok: false, status: 400, error: 'invalid_slot' })
  })

  it('un segundo activate sobre un equipo ya activado devuelve 409, no pisa nada', async () => {
    await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, activacionValida())
    const segundo = await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      verifier: 'a'.repeat(64),
      wraps: [
        { slot: leaderDevice, kind: 'device', wrapped: 'W-2' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'W-REC-2', wrap_meta: { salt: 'S2' } },
      ],
    })
    expect(segundo).toEqual({ ok: false, status: 409, error: 'already_activated' })
    const { rows } = await pool.query(
      'select wrapped from team_key_wraps where team_id = $1 and slot = $2', [teamId, leaderDevice]
    )
    expect(rows[0].wrapped).toBe('W-LEADER')
    expect((await pool.query('select verifier from team_keys where team_id = $1', [teamId])).rows[0].verifier).toBe(VERIFICADOR)
  })
})

describe('authorizeTeamDevice', () => {
  let segundoLeaderId: string, segundoLeaderDevice: string

  beforeEach(async () => {
    await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, activacionValida())
    // Un SEGUNDO leader, sin clave: existe por diseño (spec §6 — transferir el rol no transfiere
    // la clave). Es el atacante de C2.
    segundoLeaderId = randomUUID()
    segundoLeaderDevice = randomUUID()
    await pool.query('insert into users (id) values ($1)', [segundoLeaderId])
    await pool.query(
      `insert into team_memberships (user_id, team_id, team_name, role, status)
       values ($1, $2, 'Equipo', 'leader', 'active')`,
      [segundoLeaderId, teamId]
    )
    await pool.query('insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)',
      [segundoLeaderDevice, segundoLeaderId, 'leader2-pc', 'hash-' + segundoLeaderDevice])
  })

  it('rechaza con 403 a quien no es leader', async () => {
    const res = await authorizeTeamDevice(pool, { deviceId: memberDevice, userId: memberId }, teamId, {
      proof: PRUEBA, wraps: [{ slot: memberDevice, kind: 'device', wrapped: 'W-MEMBER' }],
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
      proof: PRUEBA, wraps: [{ slot: memberDevice, kind: 'device', wrapped: 'W' }],
    })
    expect(res).toEqual({ ok: false, status: 404, error: 'not_activated' })
  })

  it('el leader con la clave autoriza al member: la wrap queda publicada', async () => {
    const res = await authorizeTeamDevice(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      proof: PRUEBA, wraps: [{ slot: memberDevice, kind: 'device', wrapped: 'W-MEMBER' }],
    })
    expect(res).toEqual({ ok: true })
    const { rows } = await pool.query(
      'select wrapped from team_key_wraps where team_id = $1 and slot = $2', [teamId, memberDevice]
    )
    expect(rows[0].wrapped).toBe('W-MEMBER')
  })

  it('C2 ADVERSARIAL: un leader SIN la clave no puede pisar la envoltura de un device', async () => {
    await authorizeTeamDevice(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      proof: PRUEBA, wraps: [{ slot: memberDevice, kind: 'device', wrapped: 'W-MEMBER-REAL' }],
    })
    for (const proof of ['inventada', VERIFICADOR, undefined, '']) {
      const res = await authorizeTeamDevice(pool, { deviceId: segundoLeaderDevice, userId: segundoLeaderId }, teamId, {
        proof, wraps: [{ slot: memberDevice, kind: 'device', wrapped: 'W-MAESTRA-DEL-ATACANTE' }],
      })
      expect(res).toEqual({ ok: false, status: 403, error: 'must_hold_team_key' })
    }
    const { rows } = await pool.query(
      'select wrapped from team_key_wraps where team_id = $1 and slot = $2', [teamId, memberDevice]
    )
    expect(rows[0].wrapped).toBe('W-MEMBER-REAL')
  })

  it('C2 ADVERSARIAL: tampoco puede fabricarse su propia envoltura', async () => {
    const res = await authorizeTeamDevice(pool, { deviceId: segundoLeaderDevice, userId: segundoLeaderId }, teamId, {
      proof: 'inventada', wraps: [{ slot: segundoLeaderDevice, kind: 'device', wrapped: 'W' }],
    })
    expect(res).toEqual({ ok: false, status: 403, error: 'must_hold_team_key' })
    expect((await pool.query('select 1 from team_key_wraps where team_id = $1 and slot = $2', [teamId, segundoLeaderDevice])).rows).toHaveLength(0)
  })

  it('una prueba con caracteres multibyte no rompe la comparación (403, no 500)', async () => {
    const res = await authorizeTeamDevice(pool, { deviceId: segundoLeaderDevice, userId: segundoLeaderId }, teamId, {
      proof: 'ñ'.repeat(64), wraps: [{ slot: memberDevice, kind: 'device', wrapped: 'W' }],
    })
    expect(res).toEqual({ ok: false, status: 403, error: 'must_hold_team_key' })
  })

  it('nunca permite tocar el slot recovery desde authorize', async () => {
    const res = await authorizeTeamDevice(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      proof: PRUEBA, wraps: [{ slot: 'recovery', kind: 'recovery', wrapped: 'W-NUEVO' }],
    })
    expect(res).toEqual({ ok: false, status: 400, error: 'cannot_overwrite_recovery' })
  })
})

describe('Task 15b — I1: un device que regenera su par pierde también su envoltura de EQUIPO', () => {
  it('reaparece en pendingDevices del leader y su status deja de decir has_wrap', async () => {
    // El member ya estaba autorizado en el equipo: pública vieja + envoltura sellada para ella.
    await enrollDeviceKey(pool, { deviceId: memberDevice, userId: memberId }, { public_key: 'PUB-VIEJA' })
    await enrollDeviceKey(pool, { deviceId: leaderDevice, userId: leaderId }, { public_key: 'PUB-LEADER' })
    await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, activacionValida())
    await authorizeTeamDevice(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      proof: PRUEBA, wraps: [{ slot: memberDevice, kind: 'device', wrapped: 'W-PARA-PUB-VIEJA' }],
    })
    const antes = await getTeamKeyState(pool, { deviceId: leaderDevice, userId: leaderId }, teamId)
    expect('ok' in antes ? null : antes.pendingDevices).toEqual([])

    // keys.bin corrupto / llavero restaurado: el member publica una pública NUEVA.
    await enrollDeviceKey(pool, { deviceId: memberDevice, userId: memberId }, { public_key: 'PUB-NUEVA' })

    const despues = await getTeamKeyState(pool, { deviceId: leaderDevice, userId: leaderId }, teamId)
    expect('ok' in despues ? null : despues.pendingDevices)
      .toEqual([{ deviceId: memberDevice, name: 'member-pc', publicKey: 'PUB-NUEVA' }])
    const delMember = await getTeamKeyState(pool, { deviceId: memberDevice, userId: memberId }, teamId)
    expect('ok' in delMember ? 'error' : delMember.wrap).toBeNull()
    const status = await handleStatus(pool, { deviceId: memberDevice, userId: memberId, plan: 'team' })
    expect(status.encrypted_teams).toEqual([{ team_id: teamId, has_wrap: false }])
    // La de recuperación no es de ningún device: no se toca.
    const { rows } = await pool.query(
      `select slot from team_key_wraps where team_id = $1 order by slot`, [teamId]
    )
    expect(rows.map((r) => r.slot).sort()).toEqual([leaderDevice, 'recovery'].sort())
  })

  it('re-publicar la MISMA pública no borra nada', async () => {
    await enrollDeviceKey(pool, { deviceId: leaderDevice, userId: leaderId }, { public_key: 'PUB-LEADER' })
    await activateTeamKey(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, activacionValida())
    await enrollDeviceKey(pool, { deviceId: leaderDevice, userId: leaderId }, { public_key: 'PUB-LEADER' })
    const res = await getTeamKeyState(pool, { deviceId: leaderDevice, userId: leaderId }, teamId)
    expect('ok' in res ? null : res.wrap).toEqual({ wrapped: 'W-LEADER', wrapMeta: null })
  })
})
