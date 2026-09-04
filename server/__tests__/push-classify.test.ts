import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { getPool, migrate } from '../src/db'
import { handlePush, classifyPushError, TerminalPushError } from '../src/push'

const pool = getPool()
let auth: { deviceId: string; userId: string; plan: string }

const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = (label: string) => `classify-${RUN}-${label}`

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'classify', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId, plan: 'pro' }
})

afterAll(async () => { await pool.end() })

const sqlstate = (code: string) => Object.assign(new Error(code), { code })

describe('classifyPushError', () => {
  it('treats data and integrity exceptions as terminal', () => {
    expect(classifyPushError(sqlstate('22P02'))).toBe('invalid_payload') // bigint got a word
    expect(classifyPushError(sqlstate('22001'))).toBe('invalid_payload') // value too long
    expect(classifyPushError(sqlstate('23505'))).toBe('constraint_violation') // unique
    expect(classifyPushError(sqlstate('23503'))).toBe('constraint_violation') // foreign key
    expect(classifyPushError(sqlstate('23502'))).toBe('constraint_violation') // not null
  })

  it('leaves connection, deadlock and serialization failures retryable', () => {
    // Every one of these can succeed on the very next attempt, so rejecting them would
    // throw the mutation away: the client marks a `rejected` pushed and never resends it.
    expect(classifyPushError(sqlstate('08006'))).toBeNull() // connection failure
    expect(classifyPushError(sqlstate('08003'))).toBeNull() // connection does not exist
    expect(classifyPushError(sqlstate('40001'))).toBeNull() // serialization failure
    expect(classifyPushError(sqlstate('40P01'))).toBeNull() // deadlock detected
    expect(classifyPushError(sqlstate('53300'))).toBeNull() // too many connections
    expect(classifyPushError(sqlstate('57P01'))).toBeNull() // admin shutdown
    expect(classifyPushError(sqlstate('55P03'))).toBeNull() // lock not available
  })

  it('does not read a driver code as if it were a SQLSTATE', () => {
    // 'ECONNREFUSED'.slice(0, 2) is 'EC', which happens to miss the terminal table — but a
    // future code starting with '22' or '23' would not. The shape is checked, not guessed.
    expect(classifyPushError(sqlstate('ECONNREFUSED'))).toBeNull()
    expect(classifyPushError(sqlstate('ETIMEDOUT'))).toBeNull()
    expect(classifyPushError(new Error('no code at all'))).toBeNull()
    expect(classifyPushError(undefined)).toBeNull()
    expect(classifyPushError(null)).toBeNull()
  })

  it('reports the code a TerminalPushError carries', () => {
    expect(classifyPushError(new TerminalPushError('sync_id_conflict'))).toBe('sync_id_conflict')
  })
})

/**
 * Wraps the real pool so ONE statement fails with a chosen error and everything else runs
 * against the real database. A transient SQLSTATE cannot be provoked from a payload — that
 * is what makes it transient — so this is the only way to drive the omitted branch end to
 * end. Everything the branch depends on (the transaction, the rollback, the receipt claim)
 * is genuine; only the failure is injected.
 */
function poolFailingOn(match: string, targetSyncId: string, err: Error): Pool {
  return {
    connect: async () => {
      const client: PoolClient = await pool.connect()
      return new Proxy(client, {
        get(target, prop, receiver) {
          if (prop === 'query') {
            return (text: unknown, params?: unknown[]) => {
              if (typeof text === 'string' && text.includes(match) && params?.[0] === targetSyncId) {
                return Promise.reject(err)
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
}

describe('a transient failure is omitted, not rejected', () => {
  it('omits it, keeps the batch going, and leaves it fully retryable', async () => {
    const p = PROJECT('transient')
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' })
    const flaky = poolFailingOn('insert into observations', SYNC('transient'), deadlock)

    const mutation = (seq: number, syncId: string) => ({
      seq, sync_id: syncId, op: 'upsert' as const,
      payload: {
        sync_id: syncId, project_key: p, project_display_name: p, scope: 'personal',
        type: 'decision', topic_key: null, title: syncId, content: 'x', tags: [],
        lamport: 1, updated_at: Date.now(), created_at: Date.now(),
      },
    })

    const res = await handlePush(flaky, auth, {
      mutations: [
        mutation(2200, SYNC('before')),
        mutation(2201, SYNC('transient')),
        mutation(2202, SYNC('after')),
      ],
    })

    const ids = res.results.map((r) => r.sync_id)
    expect(ids).toContain(SYNC('before'))
    expect(ids).toContain(SYNC('after')) // the batch kept going
    expect(ids).not.toContain(SYNC('transient')) // omitted, NOT rejected — the contract
    expect(res.results.some((r) => r.outcome === 'rejected')).toBe(false)

    // Nothing persisted, and — critically — the receipt claim rolled back with it, so the
    // same (device_id, seq) is free for the retry.
    const rows = await pool.query('select count(*)::int as n from observations where sync_id = $1', [SYNC('transient')])
    expect(rows.rows[0].n).toBe(0)
    const receipts = await pool.query(
      'select count(*)::int as n from push_receipts where device_id = $1 and seq = $2',
      [auth.deviceId, 2201]
    )
    expect(receipts.rows[0].n).toBe(0)

    // The retry, against the healthy pool, succeeds with the same seq.
    const retried = await handlePush(pool, auth, { mutations: [mutation(2201, SYNC('transient'))] })
    expect(retried.results[0]).toMatchObject({ sync_id: SYNC('transient'), outcome: 'applied' })
  })
})
