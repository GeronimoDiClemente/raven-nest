import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
let auth: { deviceId: string; userId: string; plan: string }
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
  auth = { deviceId, userId, plan: 'pro' }
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

  it('upserts each project ONCE per batch, not once per mutation', async () => {
    // `ensureProject` used to run inside the loop, so a 200-mutation batch fired 200
    // upserts at the same `projects` row — ~400 dead tuples per push (the seq allocation
    // updates it once more per mutation) on the one row every push has to lock anyway.
    // Counted at the statement level because pg_stat_user_tables is sampled asynchronously
    // and cannot answer "how many times" precisely.
    const projects: string[] = []
    const counting = {
      connect: async () => {
        const client: PoolClient = await pool.connect()
        return new Proxy(client, {
          get(target, prop, receiver) {
            if (prop === 'query') {
              return (text: unknown, params?: unknown[]) => {
                if (typeof text === 'string' && text.includes('insert into projects')) {
                  projects.push(String(params?.[1]))
                }
                return (target.query as (t: unknown, p?: unknown[]) => Promise<unknown>)(text, params)
              }
            }
            const value = Reflect.get(target, prop, receiver)
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
      },
    } as unknown as Pool

    const a = PROJECT()
    const b = PROJECT()
    const res = await handlePush(counting, auth, {
      mutations: [
        mutation(95, SYNC('hoist-1'), a),
        mutation(96, SYNC('hoist-2'), a),
        mutation(97, SYNC('hoist-3'), b),
        mutation(98, SYNC('hoist-4'), a),
        mutation(99, SYNC('hoist-5'), b),
      ],
    })

    expect(res.results.map((r) => r.outcome)).toEqual(Array(5).fill('applied'))
    expect(projects).toEqual([a, b]) // one upsert per DISTINCT project_key, in first-seen order
    // And the seq allocation is untouched: still one per mutation, still gapless per project.
    const seqs = res.results.map((r) => r.project_seq)
    expect([seqs[0], seqs[1], seqs[3]]).toEqual([1, 2, 3]) // project a
    expect([seqs[2], seqs[4]]).toEqual([1, 2]) // project b
  })

  it('rejects a mutation with no sync_id instead of collapsing them all onto one row', async () => {
    // `m.sync_id ?? String(p.sync_id ?? '')` used to yield the empty string, which is a
    // perfectly valid text primary key — so every malformed push from every account in the
    // world upserted the SAME row, overwriting each other. Terminal: no retry of this
    // payload can grow a sync_id.
    const p = PROJECT()
    const countEmpty = async () =>
      (await pool.query(`select count(*)::int as n from observations where sync_id = ''`)).rows[0].n
    const before = await countEmpty()

    const res = await handlePush(pool, auth, {
      mutations: [
        {
          seq: 90,
          sync_id: undefined as unknown as string,
          op: 'upsert',
          payload: { project_key: p, title: 'sin id', content: 'x', lamport: 1, updated_at: Date.now() },
        },
        mutation(91, SYNC('after-no-id'), p),
      ],
    })

    expect(res.results[0]).toMatchObject({ sync_id: '', outcome: 'rejected', error: 'missing_sync_id' })
    expect(res.results[1]).toMatchObject({ sync_id: SYNC('after-no-id'), outcome: 'applied' })
    expect(await countEmpty()).toBe(before)
  })

  it('rejects a terminally-broken mutation, keeps the batch going, and persists nothing', async () => {
    const p = PROJECT()
    const res = await handlePush(pool, auth, {
      mutations: [
        mutation(70, SYNC('ok-before'), p),
        // A real 22P02 from Postgres: lamport is bigint and this is not a number. No mock,
        // no schema change — the transaction genuinely fails mid-flight. SQLSTATE class 22
        // is a data exception, so no retry of this exact payload can ever get past it:
        // reporting it as `rejected` is what stops the client resending it forever.
        mutation(71, SYNC('bad'), p, { lamport: 'not-a-number' }),
        mutation(72, SYNC('ok-after'), p),
      ],
    })

    const ids = res.results.map((r) => r.sync_id)
    expect(ids).toContain(SYNC('ok-before'))
    expect(ids).toContain(SYNC('ok-after')) // the loop kept going after the failure
    const bad = res.results.find((r) => r.sync_id === SYNC('bad'))
    expect(bad).toMatchObject({ outcome: 'rejected', error: 'invalid_payload' })

    // Rejected is a REPORT, not a write: the transaction still rolled back whole.
    const { rows } = await pool.query('select count(*)::int as n from observations where sync_id = $1', [SYNC('bad')])
    expect(rows[0].n).toBe(0)
    const receipts = await pool.query(
      'select count(*)::int as n from push_receipts where device_id = $1 and sync_id = $2',
      [auth.deviceId, SYNC('bad')]
    )
    expect(receipts.rows[0].n).toBe(0)
  })

  it('a retry of the rejected mutation with the same device seq succeeds afterwards', async () => {
    const p = PROJECT()
    const seq = 80
    const syncId = SYNC('retry-me')

    const failed = await handlePush(pool, auth, {
      mutations: [mutation(seq, syncId, p, { lamport: 'not-a-number' })],
    })
    // The rejection rolled back with the receipt claim, so the seq is free again. The real
    // client would not resend a `rejected` mutation, but a FIXED payload under the same
    // device seq must not be locked out by the failed attempt's claim.
    expect(failed.results[0]).toMatchObject({ sync_id: syncId, outcome: 'rejected' })

    const retried = await handlePush(pool, auth, { mutations: [mutation(seq, syncId, p)] })
    expect(retried.results[0]).toMatchObject({ sync_id: syncId, outcome: 'applied' })
    const { rows } = await pool.query('select count(*)::int as n from observations where sync_id = $1', [syncId])
    expect(rows[0].n).toBe(1)
  })
})
