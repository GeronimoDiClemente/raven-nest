import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'
import { handlePull } from '../src/pull'

const pool = getPool()
let auth: { deviceId: string; userId: string }

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
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'pull', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId }
})

afterAll(async () => { await pool.end() })

const mut = (seq: number, syncId: string, p: string, extra: Record<string, unknown> = {}) => ({
  seq, sync_id: syncId, op: 'upsert' as const,
  payload: {
    sync_id: syncId, project_key: p, project_display_name: p, scope: 'personal',
    type: 'decision', topic_key: null, title: syncId, content: 'body', tags: ['t'],
    lamport: 1, updated_at: Date.now(), created_at: Date.now(), ...extra,
  },
})

describe('handlePull', () => {
  it('returns project_key, a real tags array, and the client timestamp', async () => {
    const p = `pull-${randomUUID().slice(0, 8)}`
    const stamp = Date.now() - 3_600_000
    const syncId = sid('pull-1')
    await handlePush(pool, auth, { mutations: [mut(700, syncId, p, { tags: ['a', 'b'], updated_at: stamp })] })

    const res = await handlePull(pool, auth, { cursors: { [p]: 0 }, limit: 500 })
    const row = res.rows.find((r) => r.sync_id === syncId)!
    expect(row.project_key).toBe(p)
    expect(Array.isArray(row.tags)).toBe(true)
    expect(row.tags).toEqual(['a', 'b'])
    expect(new Date(row.client_updated_at).getTime()).toBe(stamp)
  })

  it('advances the cursor and a second pull returns nothing', async () => {
    const p = `pull-${randomUUID().slice(0, 8)}`
    await handlePush(pool, auth, { mutations: [mut(710, sid('pull-2'), p)] })
    const first = await handlePull(pool, auth, { cursors: { [p]: 0 }, limit: 500 })
    expect(first.rows.length).toBeGreaterThan(0)
    const second = await handlePull(pool, auth, { cursors: first.cursors, limit: 500 })
    expect(second.rows).toHaveLength(0)
  })

  it('never returns a project whose cursor the device did not send', async () => {
    const known = `pull-${randomUUID().slice(0, 8)}`
    const unknown = `pull-${randomUUID().slice(0, 8)}`
    await handlePush(pool, auth, { mutations: [mut(720, sid('known-1'), known)] })
    await handlePush(pool, auth, { mutations: [mut(721, sid('unknown-1'), unknown)] })

    const res = await handlePull(pool, auth, { cursors: { [known]: 0 }, limit: 500 })
    expect(res.rows.some((r) => r.project_key === known)).toBe(true)
    expect(res.rows.some((r) => r.project_key === unknown)).toBe(false)
  })

  it('honours the limit and orders by project_seq', async () => {
    const p = `pull-${randomUUID().slice(0, 8)}`
    await handlePush(pool, auth, {
      mutations: [mut(730, sid('l-1'), p), mut(731, sid('l-2'), p), mut(732, sid('l-3'), p)],
    })
    const res = await handlePull(pool, auth, { cursors: { [p]: 0 }, limit: 2 })
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0].project_seq).toBeLessThan(res.rows[1].project_seq)
  })

  it('tells the client when to come back', async () => {
    const p = `pull-${randomUUID().slice(0, 8)}`
    const res = await handlePull(pool, auth, { cursors: { [p]: 0 }, limit: 10 })
    expect(typeof res.next_poll_ms).toBe('number')
  })

  it('never leaks another user rows', async () => {
    const otherUser = randomUUID()
    const otherDevice = randomUUID()
    await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [otherUser])
    await pool.query(
      `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'other', $3)`,
      [otherDevice, otherUser, `hash-${otherDevice}`]
    )
    const shared = `pull-shared-${randomUUID().slice(0, 8)}`
    await handlePush(pool, { deviceId: otherDevice, userId: otherUser }, { mutations: [mut(740, sid('theirs'), shared)] })
    await handlePush(pool, auth, { mutations: [mut(741, sid('mine'), shared)] })

    const res = await handlePull(pool, auth, { cursors: { [shared]: 0 }, limit: 500 })
    expect(res.rows.some((r) => r.sync_id === sid('mine'))).toBe(true)
    expect(res.rows.some((r) => r.sync_id === sid('theirs'))).toBe(false)
  })
})
