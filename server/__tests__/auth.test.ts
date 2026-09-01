import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { hashToken, authenticate } from '../src/auth'

const pool = getPool()

// The test DB persists between runs and devices.token_hash is uniquely indexed, so a fixed
// token literal collides with the row a previous run left behind. Suffix every token with a
// per-run id, same discipline as the randomUUID() already used for users and devices below.
const RUN = randomUUID()
const TOKEN = `nmk_auth_test_token_${RUN}`
let userId: string
let deviceId: string

beforeAll(async () => {
  await migrate(pool)
  userId = randomUUID()
  deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'test-device', $3)`,
    [deviceId, userId, hashToken(TOKEN)]
  )
  await pool.query('insert into allowlist (user_id) values ($1)', [userId])
})

afterAll(async () => { await pool.end() })

describe('authenticate', () => {
  it('accepts a known token', async () => {
    const r = await authenticate(pool, `Bearer ${TOKEN}`)
    expect(r).toMatchObject({ ok: true, deviceId, userId, plan: 'pro' })
  })

  it('never stores the token itself', async () => {
    const { rows } = await pool.query('select token_hash from devices where id = $1', [deviceId])
    expect(rows[0].token_hash).not.toContain(TOKEN)
    expect(rows[0].token_hash).toBe(hashToken(TOKEN))
  })

  it('rejects a missing header with 401', async () => {
    expect(await authenticate(pool, undefined)).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects an unknown token with 401', async () => {
    expect(await authenticate(pool, 'Bearer nope')).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects a revoked device with 401', async () => {
    const revokedToken = `nmk_revoked_${RUN}`
    const revokedId = randomUUID()
    await pool.query(
      `insert into devices (id, user_id, name, token_hash, revoked_at)
       values ($1, $2, 'revoked', $3, now())`,
      [revokedId, userId, hashToken(revokedToken)]
    )
    expect(await authenticate(pool, `Bearer ${revokedToken}`)).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects a user outside the allowlist with 403 not_in_beta', async () => {
    const outsiderId = randomUUID()
    const outsiderDevice = randomUUID()
    const outsiderToken = `nmk_outsider_${RUN}`
    await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [outsiderId])
    await pool.query(
      `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'outsider', $3)`,
      [outsiderDevice, outsiderId, hashToken(outsiderToken)]
    )
    expect(await authenticate(pool, `Bearer ${outsiderToken}`)).toMatchObject({
      ok: false, status: 403, error: 'not_in_beta',
    })
  })

  it('rejects a free plan with 403 plan_required', async () => {
    const freeId = randomUUID()
    const freeDevice = randomUUID()
    const freeToken = `nmk_free_${RUN}`
    await pool.query(`insert into users (id, plan) values ($1, 'free')`, [freeId])
    await pool.query(
      `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'free', $3)`,
      [freeDevice, freeId, hashToken(freeToken)]
    )
    await pool.query('insert into allowlist (user_id) values ($1)', [freeId])
    expect(await authenticate(pool, `Bearer ${freeToken}`)).toMatchObject({
      ok: false, status: 403, error: 'plan_required',
    })
  })
})
