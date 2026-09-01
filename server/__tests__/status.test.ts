import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'
import { handleStatus, resolveMaxBytes } from '../src/status'

const pool = getPool()
let auth: { deviceId: string; userId: string; plan: string }

// observations.sync_id is a global primary key and the test DB persists between runs, so
// every sync_id used here must be unique per run — prefix with a fresh token each run.
const RUN = randomUUID().slice(0, 8)
const sid = (label: string) => `${RUN}-${label}`

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'status', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId, plan: 'pro' }
})

afterAll(async () => { await pool.end() })

const GIB = 1024 * 1024 * 1024

describe('resolveMaxBytes', () => {
  it('takes a sane value from the env', () => {
    expect(resolveMaxBytes('2048')).toBe(2048)
    expect(resolveMaxBytes(String(GIB * 2))).toBe(GIB * 2)
  })

  it('falls back to the default instead of putting NaN in every status response', () => {
    // A quota the user can see, so a typo in the env used to surface as `NaN` in the UI on
    // every single request, with nothing logged anywhere.
    for (const bad of [undefined, '', '   ', '1gb', 'lots', 'NaN', '-1', '0', 'Infinity']) {
      expect([bad, resolveMaxBytes(bad)]).toEqual([bad, GIB])
    }
  })
})

describe('handleStatus', () => {
  it('reports a finite quota ceiling', async () => {
    const res = await handleStatus(pool, auth)
    expect(Number.isFinite(res.quota.max_bytes)).toBe(true)
    expect(res.quota.max_bytes).toBeGreaterThan(0)
  })

  it('reports the device, the plan and when to poll again', async () => {
    const res = await handleStatus(pool, auth)
    expect(res.device_id).toBe(auth.deviceId)
    expect(res.user_id).toBe(auth.userId)
    expect(res.plan).toBe('pro')
    expect(typeof res.next_poll_ms).toBe('number')
    expect(Number.isNaN(Date.parse(res.server_time))).toBe(false)
  })

  it('counts only this user bytes', async () => {
    const p = `status-${randomUUID().slice(0, 8)}`
    const before = await handleStatus(pool, auth)
    await handlePush(pool, auth, {
      mutations: [{
        seq: 800, sync_id: sid('status-1'), op: 'upsert',
        payload: {
          sync_id: sid('status-1'), project_key: p, project_display_name: p, scope: 'personal',
          type: 'decision', topic_key: null, title: 't', content: 'x'.repeat(1000),
          tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
        },
      }],
    })
    const afterMine = await handleStatus(pool, auth)
    expect(afterMine.quota.used_bytes).toBeGreaterThanOrEqual(before.quota.used_bytes + 1000)

    // The check above alone would pass even without a `where user_id = $1` filter — any
    // bytes added anywhere would still make `auth`'s total go up. Prove isolation for
    // real: push a much bigger observation under a SECOND, unrelated user and confirm it
    // does not move `auth`'s used_bytes at all. A missing per-user filter would leak that
    // other user's bytes into this total and fail this assertion.
    const otherUserId = randomUUID()
    const otherDeviceId = randomUUID()
    await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [otherUserId])
    await pool.query(
      `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'status-other', $3)`,
      [otherDeviceId, otherUserId, `hash-${otherDeviceId}`]
    )
    const otherAuth = { deviceId: otherDeviceId, userId: otherUserId, plan: 'pro' }
    const p2 = `status-other-${randomUUID().slice(0, 8)}`
    await handlePush(pool, otherAuth, {
      mutations: [{
        seq: 800, sync_id: sid('status-other-1'), op: 'upsert',
        payload: {
          sync_id: sid('status-other-1'), project_key: p2, project_display_name: p2, scope: 'personal',
          type: 'decision', topic_key: null, title: 't', content: 'y'.repeat(50_000),
          tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
        },
      }],
    })

    const afterOther = await handleStatus(pool, auth)
    expect(afterOther.quota.used_bytes).toBe(afterMine.quota.used_bytes)
  })
})
