// Mismo patrón que server/__tests__/http.test.ts: arranca el server real (createApp) en un
// puerto efímero y le pega con fetch, para probar el ruteo + la autenticación, no sólo las
// funciones sueltas (esas ya las prueba team-keys.test.ts / team-keys-recrypt.test.ts).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { getPool, migrate } from '../src/db'
import { createApp } from '../src/http'

const pool = getPool()
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
    expect(await res.json()).toEqual({ activated: false, wrap: null, pendingDevices: [] })
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
      body: JSON.stringify({ team_id: teamId, wraps: [{ slot: leaderDeviceId, kind: 'device', wrapped: 'W-L' }] }),
    })
    expect(act.status).toBe(200)

    const auth = await fetch(`${baseUrl}/v1/teams/key/authorize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${leaderToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, wraps: [{ slot: memberDeviceId, kind: 'device', wrapped: 'W-M' }] }),
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
})
