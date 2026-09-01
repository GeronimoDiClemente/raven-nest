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

  it('honours the limit, orders by project_seq, and advances the cursor to the last row actually returned', async () => {
    const p = `pull-${randomUUID().slice(0, 8)}`
    await handlePush(pool, auth, {
      mutations: [mut(730, sid('l-1'), p), mut(731, sid('l-2'), p), mut(732, sid('l-3'), p)],
    })
    const res = await handlePull(pool, auth, { cursors: { [p]: 0 }, limit: 2 })
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0].project_seq).toBeLessThan(res.rows[1].project_seq)

    // The cursor must land on the second row's project_seq — the last row actually
    // returned — not the third row's, which was cut off by the limit. A cursor that
    // jumped past a truncated row would silently drop it forever: the next pull would
    // never ask for it again.
    expect(res.cursors[p]).toBe(res.rows[1].project_seq)

    const rest = await handlePull(pool, auth, { cursors: res.cursors, limit: 500 })
    expect(rest.rows).toHaveLength(1)
    expect(rest.rows[0].sync_id).toBe(sid('l-3'))
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

  describe('malformed device input is clamped, not trusted', () => {
    // `limit` and every cursor value are device-controlled and go straight into a
    // parameterized bigint query. Passed through raw, each of these four throws out of
    // handlePull against real Postgres (verified before this fix): a negative limit
    // ("LIMIT must not be negative"), a non-numeric limit or cursor (bigint "NaN"), and a
    // fractional limit (bigint "2.7"). A malformed client field must never turn into a
    // 500 — it must be clamped to a safe, well-defined value instead.

    it('resolves instead of throwing on a negative limit, falling back to the max', async () => {
      const p = `pull-${randomUUID().slice(0, 8)}`
      await handlePush(pool, auth, { mutations: [mut(750, sid('bad-limit-neg'), p)] })

      const call = handlePull(pool, auth, { cursors: { [p]: 0 }, limit: -5 })
      await expect(call).resolves.toBeDefined()
      const res = await call
      expect(res.rows.some((r) => r.sync_id === sid('bad-limit-neg'))).toBe(true)
    })

    it('resolves instead of throwing on a non-numeric limit, falling back to the max', async () => {
      const p = `pull-${randomUUID().slice(0, 8)}`
      await handlePush(pool, auth, { mutations: [mut(751, sid('bad-limit-nan'), p)] })

      const call = handlePull(pool, auth, {
        cursors: { [p]: 0 },
        limit: 'not-a-number' as unknown as number,
      })
      await expect(call).resolves.toBeDefined()
      const res = await call
      expect(res.rows.some((r) => r.sync_id === sid('bad-limit-nan'))).toBe(true)
    })

    it('resolves instead of throwing on a fractional limit, flooring it', async () => {
      const p = `pull-${randomUUID().slice(0, 8)}`
      await handlePush(pool, auth, {
        mutations: [mut(752, sid('frac-1'), p), mut(753, sid('frac-2'), p), mut(754, sid('frac-3'), p)],
      })

      const call = handlePull(pool, auth, { cursors: { [p]: 0 }, limit: 2.7 })
      await expect(call).resolves.toBeDefined()
      const res = await call
      // 2.7 must floor to 2 rows, not be passed through as-is (which Postgres rejects)
      // and not silently become 0 or all 3 rows either.
      expect(res.rows).toHaveLength(2)
    })

    it('resolves instead of throwing on a non-numeric cursor, falling back to 0', async () => {
      const p = `pull-${randomUUID().slice(0, 8)}`
      await handlePush(pool, auth, { mutations: [mut(755, sid('bad-cursor'), p)] })

      const call = handlePull(pool, auth, {
        cursors: { [p]: 'not-a-number' as unknown as number },
        limit: 500,
      })
      await expect(call).resolves.toBeDefined()
      const res = await call
      // A cursor that cannot be parsed falls back to 0 — "send everything for this
      // project" — the same safe starting point as a device that has never synced it.
      expect(res.rows.some((r) => r.sync_id === sid('bad-cursor'))).toBe(true)
      // And the bad value must not silently round-trip back to the client unchanged.
      expect(res.cursors[p]).not.toBe('not-a-number')
      expect(typeof res.cursors[p]).toBe('number')
    })
  })
})
