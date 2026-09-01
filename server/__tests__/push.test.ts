import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
let auth: { deviceId: string; userId: string }
const PROJECT = () => `push-test-${randomUUID().slice(0, 8)}`

// The test DB persists between runs and observations.sync_id is a GLOBAL primary key, so a
// fixed literal like 'obs-1' collides with the row a previous run left behind. Prefix every
// sync_id with a per-run token, same discipline already used in auth.test.ts and seq.test.ts.
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'push', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId }
})

afterAll(async () => { await pool.end() })

function mutation(seq: number, syncId: string, projectKey: string, extra: Record<string, unknown> = {}) {
  return {
    seq,
    sync_id: syncId,
    op: 'upsert' as const,
    payload: {
      sync_id: syncId,
      project_key: projectKey,
      project_display_name: projectKey,
      scope: 'personal',
      type: 'decision',
      topic_key: null,
      title: 'a title',
      content: 'a body',
      tags: ['x'],
      lamport: 1,
      updated_at: Date.now(),
      created_at: Date.now(),
      ...extra,
    },
  }
}

describe('handlePush', () => {
  it('applies a new observation and reports its project_seq', async () => {
    const p = PROJECT()
    const res = await handlePush(pool, auth, { mutations: [mutation(1, SYNC('obs-1'), p)] })
    expect(res.results).toHaveLength(1)
    expect(res.results[0]).toMatchObject({ sync_id: SYNC('obs-1'), outcome: 'applied' })
    expect(res.results[0].project_seq).toBeGreaterThan(0)
  })

  it('creates the project on first sight and keeps its display name', async () => {
    const p = PROJECT()
    await handlePush(pool, auth, { mutations: [mutation(10, SYNC('obs-2'), p)] })
    const { rows } = await pool.query(
      'select display_name from projects where user_id = $1 and project_key = $2',
      [auth.userId, p]
    )
    expect(rows[0].display_name).toBe(p)
  })

  it('replaying the same (device_id, seq) returns the stored result, not a new one', async () => {
    const p = PROJECT()
    const body = { mutations: [mutation(20, SYNC('obs-3'), p)] }
    const first = await handlePush(pool, auth, body)
    const replay = await handlePush(pool, auth, body)
    expect(replay.results[0].outcome).toBe(first.results[0].outcome)
    expect(replay.results[0].project_seq).toBe(first.results[0].project_seq)
    const { rows } = await pool.query('select count(*)::int as n from observations where sync_id = $1', [SYNC('obs-3')])
    expect(rows[0].n).toBe(1)
  })

  it('assigns sequential project_seq within one batch', async () => {
    const p = PROJECT()
    const res = await handlePush(pool, auth, {
      mutations: [mutation(30, SYNC('obs-4'), p), mutation(31, SYNC('obs-5'), p), mutation(32, SYNC('obs-6'), p)],
    })
    const seqs = res.results.map((r) => r.project_seq)
    expect(seqs[1]).toBe(seqs[0] + 1)
    expect(seqs[2]).toBe(seqs[1] + 1)
  })

  it('stores tags as a real jsonb array', async () => {
    const p = PROJECT()
    await handlePush(pool, auth, { mutations: [mutation(40, SYNC('obs-7'), p, { tags: ['alfa', 'beta'] })] })
    const { rows } = await pool.query('select tags from observations where sync_id = $1', [SYNC('obs-7')])
    expect(rows[0].tags).toEqual(['alfa', 'beta'])
  })

  it('keeps the client timestamp, not the server clock', async () => {
    const p = PROJECT()
    const stamp = Date.now() - 86_400_000
    await handlePush(pool, auth, { mutations: [mutation(50, SYNC('obs-8'), p, { updated_at: stamp })] })
    const { rows } = await pool.query('select client_updated_at from observations where sync_id = $1', [SYNC('obs-8')])
    expect(new Date(rows[0].client_updated_at).getTime()).toBe(stamp)
  })

  it('never stores source_ref even when the client sends it', async () => {
    const p = PROJECT()
    await handlePush(pool, auth, {
      mutations: [mutation(60, SYNC('obs-9'), p, { source_ref: 'markdown:C:\\Users\\real\\x.md#t' })],
    })
    const { rows } = await pool.query(
      `select column_name from information_schema.columns
        where table_name = 'observations' and column_name = 'source_ref'`
    )
    expect(rows).toHaveLength(0)
  })
})
