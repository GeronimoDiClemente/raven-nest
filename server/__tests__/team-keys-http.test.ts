// Mismo patrón que server/__tests__/http.test.ts: arranca el server real (createApp) en un
// puerto efímero y le pega con fetch, para probar el ruteo + la autenticación, no sólo las
// funciones sueltas (esas ya las prueba team-keys.test.ts / team-keys-recrypt.test.ts).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { getPool, migrate } from '../src/db'
import { createApp } from '../src/http'

const pool = getPool()
// Task 15 (C2): authorize/recrypt exigen la prueba; el servidor guarda su SHA-256 al activar.
const PRUEBA = 'prueba-derivada-de-la-maestra-de-equipo'
const VERIFICADOR = createHash('sha256').update(PRUEBA, 'utf8').digest('hex')
let baseUrl: string
let server: ReturnType<typeof createApp>
let teamId: string, leaderId: string, memberId: string
let leaderToken: string, memberToken: string
let leaderDeviceId: string, memberDeviceId: string

beforeAll(async () => {
  await migrate(pool)
  server = createApp(pool)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

async function registrarDevice(userId: string, plan = 'team'): Promise<{ deviceId: string; token: string }> {
  const deviceId = randomUUID()
  const token = `nmk_${randomUUID()}`
  await pool.query('insert into users (id, plan) values ($1, $2) on conflict (id) do update set plan = excluded.plan', [userId, plan])
  await pool.query('insert into allowlist (user_id) values ($1) on conflict do nothing', [userId])
  await pool.query('insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)',
    [deviceId, userId, 'pc', createHash('sha256').update(token).digest('hex')])
  return { deviceId, token }
}

// Fixture para los tests de /v1/teams/key/recrypt: un proyecto de equipo y una fila
// scope='team' adentro, mismo estilo que server/__tests__/team-keys-recrypt.test.ts.
async function insertarObservacionDeEquipo(userId: string, teamIdDeEquipo: string): Promise<string> {
  const syncId = randomUUID()
  const { rows } = await pool.query(
    `insert into projects (user_id, project_key, display_name, team_id)
     values ($1, $2, 'p', $3) returning id`,
    [userId, `repo-${syncId.slice(0, 8)}`, teamIdDeEquipo]
  )
  const projectId = Number(rows[0].id)
  await pool.query(
    `insert into observations
       (sync_id, project_id, project_seq, scope, type, title, content, author_id, lamport,
        client_updated_at, client_created_at, deleted)
     values ($1, $2, 1, 'team', 'decision', 'en claro', 'contenido en claro', $3, 1, now(), now(), false)`,
    [syncId, projectId, userId]
  )
  return syncId
}

beforeEach(async () => {
  teamId = randomUUID(); leaderId = randomUUID(); memberId = randomUUID()
  const l = await registrarDevice(leaderId); leaderDeviceId = l.deviceId; leaderToken = l.token
  const m = await registrarDevice(memberId); memberDeviceId = m.deviceId; memberToken = m.token
  await pool.query(
    `insert into team_memberships (user_id, team_id, team_name, role, status)
     values ($1, $2, 'Equipo', 'leader', 'active'), ($3, $2, 'Equipo', 'member', 'active')`,
    [leaderId, teamId, memberId]
  )
})

describe('/v1/teams/key*', () => {
  it('GET sin token da 401', async () => {
    const res = await fetch(`${baseUrl}/v1/teams/key?team_id=${teamId}`)
    expect(res.status).toBe(401)
  })

  it('GET con token válido devuelve el estado', async () => {
    const res = await fetch(`${baseUrl}/v1/teams/key?team_id=${teamId}`, {
      headers: { Authorization: `Bearer ${leaderToken}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ activated: false, verifier: null, wrap: null, pendingDevices: [] })
  })

  it('POST activate con un member da 403', async () => {
    const res = await fetch(`${baseUrl}/v1/teams/key/activate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, wraps: [{ slot: memberDeviceId, kind: 'device', wrapped: 'W' }] }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'leader_required' })
  })

  it('POST activate con el leader activa, y después authorize suma al member', async () => {
    const act = await fetch(`${baseUrl}/v1/teams/key/activate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${leaderToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        team_id: teamId, verifier: VERIFICADOR,
        wraps: [
          { slot: leaderDeviceId, kind: 'device', wrapped: 'W-L' },
          { slot: 'recovery', kind: 'recovery', wrapped: 'W-R', wrap_meta: { salt: 'S' } },
        ],
      }),
    })
    expect(act.status).toBe(200)

    const auth = await fetch(`${baseUrl}/v1/teams/key/authorize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${leaderToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, proof: PRUEBA, wraps: [{ slot: memberDeviceId, kind: 'device', wrapped: 'W-M' }] }),
    })
    expect(auth.status).toBe(200)

    const estado = await fetch(`${baseUrl}/v1/teams/key?team_id=${teamId}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    })
    const json = (await estado.json()) as { wrap: { wrapped: string } | null }
    expect(json.wrap?.wrapped).toBe('W-M')
  })

  it('GET sin team_id da 400', async () => {
    const res = await fetch(`${baseUrl}/v1/teams/key`, { headers: { Authorization: `Bearer ${leaderToken}` } })
    expect(res.status).toBe(400)
  })

  it('POST activate sin team_id da 400', async () => {
    const res = await fetch(`${baseUrl}/v1/teams/key/activate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${leaderToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ wraps: [{ slot: leaderDeviceId, kind: 'device', wrapped: 'W' }] }),
    })
    expect(res.status).toBe(400)
  })

  it('POST recrypt con un member da 403', async () => {
    const res = await fetch(`${baseUrl}/v1/teams/key/recrypt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, items: [] }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'leader_required' })
  })

  it('POST recrypt con el leader re-cifra una fila real de equipo', async () => {
    const syncId = await insertarObservacionDeEquipo(leaderId, teamId)
    await pool.query('insert into team_keys (team_id, activated_by, verifier) values ($1, $2, $3)', [teamId, leaderId, VERIFICADOR])

    const res = await fetch(`${baseUrl}/v1/teams/key/recrypt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${leaderToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        team_id: teamId, proof: PRUEBA,
        items: [{ sync_id: syncId, title: 'nmc1:x', content: 'nmc1:y', tags: [], content_hash: null, origin_account: null, lamport: 1 }],
      }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { applied: string[]; rejected: unknown[] }
    expect(json.applied).toEqual([syncId])
    expect(json.rejected).toEqual([])
  })

  // Minor de la review final: un team_id que no es uuid llegaba a Postgres (columna uuid) y
  // salía como 500 `internal_error`. Es un error del cliente.
  it('un team_id que no es uuid da 400 invalid_team_id en todas las rutas, no 500', async () => {
    const h = { Authorization: `Bearer ${leaderToken}`, 'content-type': 'application/json' }
    for (const ruta of ['/v1/teams/key', '/v1/teams/key/recrypt-pending']) {
      const res = await fetch(`${baseUrl}${ruta}?team_id=no-es-un-uuid`, { headers: h })
      expect(res.status, ruta).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_team_id' })
    }
    for (const ruta of ['/v1/teams/key/activate', '/v1/teams/key/authorize', '/v1/teams/key/recrypt']) {
      const res = await fetch(`${baseUrl}${ruta}`, { method: 'POST', headers: h, body: JSON.stringify({ team_id: 'no-es-un-uuid' }) })
      expect(res.status, ruta).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_team_id' })
    }
  })

  it('GET recrypt-pending: el leader ve lo que sigue en claro del equipo, aunque sea del member', async () => {
    const syncId = await insertarObservacionDeEquipo(memberId, teamId)
    const res = await fetch(`${baseUrl}/v1/teams/key/recrypt-pending?team_id=${teamId}`, {
      headers: { Authorization: `Bearer ${leaderToken}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ total: 1, items: [{
      sync_id: syncId, lamport: 1, title: 'en claro', content: 'contenido en claro', tags: [], content_hash: null, origin_account: null,
    }] })

    const delMember = await fetch(`${baseUrl}/v1/teams/key/recrypt-pending?team_id=${teamId}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    })
    expect(delMember.status).toBe(403)
  })

  it('POST recrypt de un leader sin la clave da 403 must_hold_team_key', async () => {
    const syncId = await insertarObservacionDeEquipo(memberId, teamId)
    await pool.query('insert into team_keys (team_id, activated_by, verifier) values ($1, $2, $3)', [teamId, leaderId, VERIFICADOR])
    const res = await fetch(`${baseUrl}/v1/teams/key/recrypt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${leaderToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        team_id: teamId, proof: 'inventada',
        items: [{ sync_id: syncId, title: 'nmc1:x', content: 'nmc1:y', tags: [], content_hash: null, origin_account: null, lamport: 1 }],
      }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'must_hold_team_key' })
  })
})
