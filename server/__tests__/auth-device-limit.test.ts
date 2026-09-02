import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { authenticate, hashToken } from '../src/auth'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })

async function seedUser(plan: string) {
  const userId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, $2)`, [userId, plan])
  await pool.query('insert into allowlist (user_id) values ($1)', [userId])
  return userId
}

async function addDevice(userId: string, label: string, createdAt: string) {
  const id = randomUUID()
  const token = `${RUN}-${label}`
  await pool.query(
    `insert into devices (id, user_id, name, token_hash, created_at) values ($1, $2, $3, $4, $5)`,
    [id, userId, label, hashToken(token), createdAt]
  )
  return token
}

describe('authenticate — tope de maquinas por plan', () => {
  it('deja sincronizar a las 3 primeras de un Free y bloquea la cuarta', async () => {
    const userId = await seedUser('free')
    const t1 = await addDevice(userId, 'd1', '2026-01-01')
    await addDevice(userId, 'd2', '2026-01-02')
    await addDevice(userId, 'd3', '2026-01-03')
    const t4 = await addDevice(userId, 'd4', '2026-01-04')

    expect((await authenticate(pool, `Bearer ${t1}`)).ok).toBe(true)

    const cuarta = await authenticate(pool, `Bearer ${t4}`)
    expect(cuarta).toMatchObject({ ok: false, status: 403, error: 'device_limit_reached' })
  })

  it('no le pone el tope de Free a una cuenta Cloud', async () => {
    const userId = await seedUser('cloud')
    await addDevice(userId, 'c1', '2026-01-01')
    await addDevice(userId, 'c2', '2026-01-02')
    await addDevice(userId, 'c3', '2026-01-03')
    const t4 = await addDevice(userId, 'c4', '2026-01-04')

    expect((await authenticate(pool, `Bearer ${t4}`)).ok).toBe(true)
  })

  // Una maquina revocada no puede seguir ocupando un lugar: si no, revocar y registrar de
  // nuevo deja al usuario permanentemente afuera de su propia cuenta.
  it('no cuenta las maquinas revocadas', async () => {
    const userId = await seedUser('free')
    await addDevice(userId, 'r1', '2026-01-01')
    await addDevice(userId, 'r2', '2026-01-02')
    const revocada = await addDevice(userId, 'r3', '2026-01-03')
    await pool.query('update devices set revoked_at = now() where token_hash = $1', [
      hashToken(revocada),
    ])
    const t4 = await addDevice(userId, 'r4', '2026-01-04')

    expect((await authenticate(pool, `Bearer ${t4}`)).ok).toBe(true)
  })
})
