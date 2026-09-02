import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'
import { handleStatus } from '../src/status'

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

  // §5.3.1: this is the ONLY place a device can learn a project exists (handlePull only
  // ever returns rows for cursors the device already sent). A roster leaking across
  // tenants would be as bad as the quota leak the test above guards against — it would
  // hand one user another user's project names.
  it('lists the caller project roster and none of a second user project', async () => {
    const p1 = sid('roster-mine')
    const p2 = sid('roster-mine-2')
    await handlePush(pool, auth, {
      mutations: [
        {
          seq: 900, sync_id: sid('roster-1'), op: 'upsert',
          payload: {
            sync_id: sid('roster-1'), project_key: p1, project_display_name: 'Mine One', scope: 'personal',
            type: 'decision', topic_key: null, title: 't', content: 'x',
            tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
          },
        },
        {
          seq: 901, sync_id: sid('roster-2'), op: 'upsert',
          payload: {
            sync_id: sid('roster-2'), project_key: p2, project_display_name: 'Mine Two', scope: 'personal',
            type: 'decision', topic_key: null, title: 't', content: 'x',
            tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
          },
        },
      ],
    })

    const otherUserId = randomUUID()
    const otherDeviceId = randomUUID()
    await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [otherUserId])
    await pool.query(
      `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'status-roster-other', $3)`,
      [otherDeviceId, otherUserId, `hash-${otherDeviceId}`]
    )
    const otherAuth = { deviceId: otherDeviceId, userId: otherUserId, plan: 'pro' }
    const pOther = sid('roster-not-mine')
    await handlePush(pool, otherAuth, {
      mutations: [{
        seq: 900, sync_id: sid('roster-other-1'), op: 'upsert',
        payload: {
          sync_id: sid('roster-other-1'), project_key: pOther, project_display_name: 'Not Mine', scope: 'personal',
          type: 'decision', topic_key: null, title: 't', content: 'x',
          tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
        },
      }],
    })

    const res = await handleStatus(pool, auth)
    const keys = res.projects.map((p) => p.project_key)
    expect(keys).toEqual(expect.arrayContaining([p1, p2]))
    expect(keys).not.toContain(pOther)
    const mine = res.projects.find((p) => p.project_key === p1)
    expect(mine?.display_name).toBe('Mine One')

    const otherRes = await handleStatus(pool, otherAuth)
    const otherKeys = otherRes.projects.map((p) => p.project_key)
    expect(otherKeys).toContain(pOther)
    expect(otherKeys).not.toEqual(expect.arrayContaining([p1, p2]))
  })
})
