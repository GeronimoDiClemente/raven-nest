import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
let auth: { deviceId: string; userId: string }

// The test DB persists between runs and observations.sync_id is a GLOBAL primary key, so a
// fixed literal like 'obs-del' collides with the row a previous run left behind. Prefix
// every sync_id with a per-run token, same discipline already used in push-topic.test.ts.
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'tomb', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId }
})

afterAll(async () => { await pool.end() })

const base = (seq: number, syncId: string, projectKey: string, op: 'upsert' | 'delete', content: string | null) => ({
  seq, sync_id: syncId, op,
  payload: {
    sync_id: syncId, project_key: projectKey, project_display_name: projectKey,
    scope: 'personal', type: 'decision', topic_key: null, title: syncId,
    content, tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
  },
})

describe('tombstones (§8.2)', () => {
  it('accepts a delete and marks the row deleted with null content', async () => {
    const p = `tomb-${randomUUID().slice(0, 8)}`
    await handlePush(pool, auth, { mutations: [base(400, SYNC('obs-del'), p, 'upsert', 'alive')] })
    const res = await handlePush(pool, auth, { mutations: [base(401, SYNC('obs-del'), p, 'delete', null)] })

    expect(res.results[0].outcome).not.toBe('rejected')
    const { rows } = await pool.query(
      'select deleted, content from observations where sync_id = $1', [SYNC('obs-del')]
    )
    expect(rows[0].deleted).toBe(true)
    expect(rows[0].content).toBeNull()
  })

  it('a delete frees the topic slot for a later live row', async () => {
    const p = `tomb-${randomUUID().slice(0, 8)}`
    const withTopic = (seq: number, syncId: string, op: 'upsert' | 'delete') => ({
      seq, sync_id: syncId, op,
      payload: {
        sync_id: syncId, project_key: p, project_display_name: p, scope: 'personal',
        type: 'decision', topic_key: 'a-slot', title: syncId, content: op === 'delete' ? null : 'x',
        tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
      },
    })
    await handlePush(pool, auth, { mutations: [withTopic(500, SYNC('slot-1'), 'upsert')] })
    await handlePush(pool, auth, { mutations: [withTopic(501, SYNC('slot-1'), 'delete')] })
    const after = await handlePush(pool, auth, { mutations: [withTopic(502, SYNC('slot-2'), 'upsert')] })

    expect(after.results[0].outcome).toBe('applied')
  })

  it('a delete never gives a tombstone the topic slot of a live row', async () => {
    const p = `tomb-${randomUUID().slice(0, 8)}`
    const live = {
      seq: 600, sync_id: SYNC('live-row'), op: 'upsert' as const,
      payload: {
        sync_id: SYNC('live-row'), project_key: p, project_display_name: p, scope: 'personal',
        type: 'decision', topic_key: 'contested', title: 'live', content: 'x', tags: [],
        lamport: 1, updated_at: Date.now(), created_at: Date.now(),
      },
    }
    const tombstone = {
      seq: 601, sync_id: SYNC('dead-row'), op: 'delete' as const,
      payload: {
        sync_id: SYNC('dead-row'), project_key: p, project_display_name: p, scope: 'personal',
        type: 'decision', topic_key: 'contested', title: 'dead', content: null, tags: [],
        lamport: 99, updated_at: Date.now() + 60_000, created_at: Date.now(),
      },
    }
    await handlePush(pool, auth, { mutations: [live] })
    await handlePush(pool, auth, { mutations: [tombstone] })

    const { rows } = await pool.query(
      'select superseded_by from observations where sync_id = $1', [SYNC('live-row')]
    )
    expect(rows[0].superseded_by).toBeNull() // the live row keeps the slot
  })
})
