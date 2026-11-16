// Task 14 (spec §9.4): el daemon tiene que saber qué equipos cifran SIN depender de que la UI
// se abra — mismo motivo por el que `key_epoch` vive en `status` (ver status.ts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handleStatus } from '../src/status'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
let auth: { deviceId: string; userId: string; plan: string }
let otroDeviceMio: string
const equipoCifrado = randomUUID()
const equipoSinCifrar = randomUUID()
const equipoDelQueMeFui = randomUUID()
const equipoAjeno = randomUUID()

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const otroUser = randomUUID()
  const deviceId = randomUUID()
  otroDeviceMio = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'team'), ($2, 'team')`, [userId, otroUser])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'a', $3), ($4, $2, 'b', $5)`,
    [deviceId, userId, `hash-${deviceId}`, otroDeviceMio, `hash-${otroDeviceMio}`]
  )
  auth = { deviceId, userId, plan: 'team' }
  const membresia = (u: string, t: string, status = 'active') => pool.query(
    `insert into team_memberships (user_id, team_id, team_name, role, status) values ($1, $2, 'e', 'member', $3)`,
    [u, t, status]
  )
  await membresia(userId, equipoCifrado)
  await membresia(userId, equipoSinCifrar)
  await membresia(userId, equipoDelQueMeFui, 'removed')
  await membresia(otroUser, equipoAjeno)
  for (const [t, quien] of [[equipoCifrado, userId], [equipoDelQueMeFui, userId], [equipoAjeno, otroUser]] as const) {
    await pool.query('insert into team_keys (team_id, activated_by) values ($1, $2)', [t, quien])
  }
  await pool.query(
    `insert into team_key_wraps (team_id, slot, kind, wrapped) values ($1, $2, 'device', 'W')`,
    [equipoCifrado, deviceId]
  )
  await pool.query(
    `insert into projects (user_id, project_key, display_name, team_id)
     values ($1, $2, 'x', $3), ($1, $4, 'y', null)`,
    [userId, `st-${RUN}-compartido`, equipoCifrado, `st-${RUN}-solo`]
  )
})

afterAll(async () => { await pool.end() })

describe('handleStatus — cifrado de equipo (Task 14)', () => {
  it('lista SÓLO los equipos cifrados donde soy miembro activo, con has_wrap de ESTE device', async () => {
    const res = await handleStatus(pool, auth)
    expect(res.encrypted_teams).toEqual([{ team_id: equipoCifrado, has_wrap: true }])
  })

  it('desde otro device de la misma cuenta, sin envoltura, has_wrap es false', async () => {
    const res = await handleStatus(pool, { ...auth, deviceId: otroDeviceMio })
    expect(res.encrypted_teams).toEqual([{ team_id: equipoCifrado, has_wrap: false }])
  })

  it('el roster trae el team_id de cada proyecto propio (null si no está compartido)', async () => {
    const res = await handleStatus(pool, auth)
    const porKey = new Map(res.projects.map((p) => [p.project_key, p]))
    expect(porKey.get(`st-${RUN}-compartido`)?.team_id).toBe(equipoCifrado)
    expect(porKey.get(`st-${RUN}-solo`)?.team_id).toBeNull()
  })
})
