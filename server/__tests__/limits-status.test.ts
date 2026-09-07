import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handleStatus } from '../src/status'

const pool = getPool()

async function seed(plan: string) {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, $2)`, [userId, plan])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'limits', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  return { deviceId, userId, plan }
}

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })

describe('status — la cuota y el intervalo salen del plan', () => {
  it('le da a Free 100 MB y 15 minutos', async () => {
    const res = await handleStatus(pool, await seed('free'))
    expect(res.quota.max_bytes).toBe(100 * 1024 * 1024)
    expect(res.next_poll_ms).toBe(900_000)
  })

  it('le da a Cloud 1 GiB y 5 minutos', async () => {
    const res = await handleStatus(pool, await seed('cloud'))
    expect(res.quota.max_bytes).toBe(1024 ** 3)
    expect(res.next_poll_ms).toBe(300_000)
  })

  it('le da a Teams 5 GiB', async () => {
    const res = await handleStatus(pool, await seed('team'))
    expect(res.quota.max_bytes).toBe(5 * 1024 ** 3)
  })
})
