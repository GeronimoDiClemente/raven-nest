import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
let auth: { deviceId: string; userId: string }

const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = (label: string) => `conc-${RUN}-${label}`

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'conc', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId }
})

afterAll(async () => { await pool.end() })

const mutation = (seq: number, syncId: string, projectKey: string) => ({
  seq,
  sync_id: syncId,
  op: 'upsert' as const,
  payload: {
    sync_id: syncId, project_key: projectKey, project_display_name: projectKey,
    scope: 'personal', type: 'decision', topic_key: null, title: 'una sola vez',
    content: 'body', tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
  },
})

describe('idempotency under concurrency (§5.1)', () => {
  // This is not a synthetic race. The client's push carries an AbortSignal timeout; when
  // it fires, the client retries while the first request is very much still in flight, so
  // two pushes of the same (device_id, seq) hit the server at once. With the receipt read
  // BEFORE the transaction and written at the end, both read "no receipt", both applied,
  // and the surviving receipt named a project_seq no row had — a permanent hole in the seq
  // space, which is exactly what the pull cursor cannot cross.
  it('two simultaneous pushes of the same (device_id, seq) apply exactly once', async () => {
    const p = PROJECT('pair')
    const seq = 2000
    const syncId = SYNC('pair')
    const body = { mutations: [mutation(seq, syncId, p)] }

    const [first, second] = await Promise.all([
      handlePush(pool, auth, body),
      handlePush(pool, auth, body),
    ])

    expect(first.results).toHaveLength(1)
    expect(second.results).toHaveLength(1)
    // The loser does not merely fail quietly: it reports the WINNER's stored receipt, so
    // both callers see the same answer for the same seq.
    expect(second.results[0]).toEqual(first.results[0])
    expect(first.results[0].outcome).toBe('applied')

    const rows = await pool.query('select count(*)::int as n from observations where sync_id = $1', [syncId])
    expect(rows.rows[0].n).toBe(1)

    // The receipt names the seq the row actually has — that agreement is the whole point.
    const receipt = await pool.query(
      'select outcome, project_seq from push_receipts where device_id = $1 and seq = $2',
      [auth.deviceId, seq]
    )
    const stored = await pool.query('select project_seq from observations where sync_id = $1', [syncId])
    expect(receipt.rows[0].outcome).toBe('applied')
    expect(Number(receipt.rows[0].project_seq)).toBe(Number(stored.rows[0].project_seq))
    expect(Number(receipt.rows[0].project_seq)).toBe(first.results[0].project_seq)

    // And the loser consumed no seq at all: one allocation for one row, no hole.
    const project = await pool.query('select seq_counter from projects where project_key = $1 and user_id = $2', [p, auth.userId])
    expect(Number(project.rows[0].seq_counter)).toBe(1)
    expect(Number(stored.rows[0].project_seq)).toBe(1)
  })

  it('holds with four simultaneous pushes, and every caller gets the same result', async () => {
    const p = PROJECT('four')
    const seq = 2100
    const syncId = SYNC('four')
    const body = { mutations: [mutation(seq, syncId, p)] }

    const all = await Promise.all(
      Array.from({ length: 4 }, () => handlePush(pool, auth, body))
    )

    const seen = all.map((r) => r.results[0])
    expect(seen.every((r) => r !== undefined)).toBe(true)
    expect(new Set(seen.map((r) => JSON.stringify(r))).size).toBe(1)

    const rows = await pool.query('select count(*)::int as n from observations where sync_id = $1', [syncId])
    expect(rows.rows[0].n).toBe(1)
    const project = await pool.query('select seq_counter from projects where project_key = $1 and user_id = $2', [p, auth.userId])
    expect(Number(project.rows[0].seq_counter)).toBe(1)
  })
})
