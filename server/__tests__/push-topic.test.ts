import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
let auth: { deviceId: string; userId: string; plan: string }

// The test DB persists between runs and observations.sync_id is a GLOBAL primary key, so a
// fixed literal like 'obs-early' collides with the row a previous run left behind. Prefix
// every sync_id with a per-run token, same discipline already used in push.test.ts.
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'topic', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId, plan: 'pro' }
})

afterAll(async () => { await pool.end() })

function topicMutation(seq: number, syncId: string, projectKey: string, updatedAt: number, lamport: number) {
  return {
    seq,
    sync_id: syncId,
    op: 'upsert' as const,
    payload: {
      sync_id: syncId, project_key: projectKey, project_display_name: projectKey,
      scope: 'personal', type: 'decision', topic_key: 'deploy-target',
      title: syncId, content: 'body', tags: [], lamport,
      updated_at: updatedAt, created_at: updatedAt,
    },
  }
}

describe('topic collision (§8.1)', () => {
  it('supersedes the loser instead of rejecting it, and keeps both rows', async () => {
    const p = `topic-${randomUUID().slice(0, 8)}`
    const now = Date.now()
    await handlePush(pool, auth, { mutations: [topicMutation(100, SYNC('obs-early'), p, now, 5)] })
    const late = await handlePush(pool, auth, {
      mutations: [topicMutation(101, SYNC('obs-late'), p, now + 60_000, 6)],
    })

    // Positive assertion: `not.toBe('rejected')` was unfalsifiable while nothing in the
    // handler ever assigned `rejected`. The late writer wins the topic, so it is `applied`.
    expect(late.results[0].outcome).toBe('applied')

    const { rows } = await pool.query(
      `select sync_id, superseded_by from observations where sync_id in ($1, $2)
       order by sync_id`,
      [SYNC('obs-early'), SYNC('obs-late')]
    )
    expect(rows).toHaveLength(2) // nothing discarded
    const early = rows.find((r) => r.sync_id === SYNC('obs-early'))
    const lateRow = rows.find((r) => r.sync_id === SYNC('obs-late'))
    expect(early.superseded_by).toBe(SYNC('obs-late'))
    expect(lateRow.superseded_by).toBeNull()
  })

  it('stores an incoming loser already superseded, and still accepts it', async () => {
    const p = `topic-${randomUUID().slice(0, 8)}`
    const now = Date.now()
    await handlePush(pool, auth, { mutations: [topicMutation(200, SYNC('obs-winner'), p, now + 60_000, 9)] })
    const loser = await handlePush(pool, auth, {
      mutations: [topicMutation(201, SYNC('obs-loser'), p, now, 1)],
    })

    expect(loser.results[0].outcome).toBe('superseded')
    const { rows } = await pool.query(
      `select superseded_by from observations where sync_id = $1`,
      [SYNC('obs-loser')]
    )
    expect(rows[0].superseded_by).toBe(SYNC('obs-winner'))
  })

  it('leaves exactly one live row for the topic', async () => {
    const p = `topic-${randomUUID().slice(0, 8)}`
    const now = Date.now()
    await handlePush(pool, auth, { mutations: [topicMutation(300, SYNC('obs-x'), p, now, 1)] })
    await handlePush(pool, auth, { mutations: [topicMutation(301, SYNC('obs-y'), p, now + 1000, 2)] })
    await handlePush(pool, auth, { mutations: [topicMutation(302, SYNC('obs-z'), p, now + 2000, 3)] })

    const { rows } = await pool.query(
      `select count(*)::int as n from observations o
        join projects pr on pr.id = o.project_id
       where pr.project_key = $1 and o.topic_key = 'deploy-target'
         and o.superseded_by is null and o.deleted = false`,
      [p]
    )
    expect(rows[0].n).toBe(1)
  })

  // The TOCTOU gap the task brief warns about: `for update` locks an EXISTING row, but
  // locks nothing when no owner exists yet. Two devices racing to be the FIRST writer on a
  // brand-new topic must still leave exactly one live row and never surface a raw
  // obs_topic_uniq violation as `rejected`/omitted.
  //
  // This is deliberately a real concurrency test (two genuinely parallel connections via
  // Promise.all), not a wall-clock-timed one — but note what it can and cannot assert
  // deterministically. WHICH of the two pushes happens to reach the advisory lock first is
  // a genuine race, and if the eventual LWW loser gets there first, ITS OWN push response
  // legitimately says 'applied' (that was true at that instant — it only becomes
  // `superseded` when the second push commits, and that pusher must learn it lost from a
  // later pull, not a retroactive push response). So the two responses' outcomes are NOT
  // deterministically ['applied', 'superseded'] — only "neither is rejected" is. What IS
  // deterministic, independent of arrival order, is the FINAL row state: obs-race-b has a
  // strictly greater updatedAt AND lamport than obs-race-a, so LWW always picks it as the
  // topic owner, whichever push happened to insert first.
  it('two concurrent first pushes to a brand-new topic never both survive obs_topic_uniq', async () => {
    const p = `topic-${randomUUID().slice(0, 8)}`
    const now = Date.now()

    const [r1, r2] = await Promise.all([
      handlePush(pool, auth, { mutations: [topicMutation(400, SYNC('obs-race-a'), p, now, 1)] }),
      handlePush(pool, auth, { mutations: [topicMutation(401, SYNC('obs-race-b'), p, now + 1, 2)] }),
    ])

    expect(r1.results).toHaveLength(1)
    expect(r2.results).toHaveLength(1)
    // Positive form of "neither is rejected": which one is `applied` and which is
    // `superseded` genuinely depends on arrival order (see the comment above), so the
    // assertion names the set of legal outcomes instead of the single illegal one.
    expect(['applied', 'superseded']).toContain(r1.results[0].outcome)
    expect(['applied', 'superseded']).toContain(r2.results[0].outcome)

    const { rows } = await pool.query(
      `select sync_id, superseded_by from observations where sync_id in ($1, $2)`,
      [SYNC('obs-race-a'), SYNC('obs-race-b')]
    )
    expect(rows).toHaveLength(2) // nothing discarded, no matter who reached the lock first

    const a = rows.find((r) => r.sync_id === SYNC('obs-race-a'))
    const b = rows.find((r) => r.sync_id === SYNC('obs-race-b'))
    expect(b.superseded_by).toBeNull() // b dominates on both updatedAt and lamport
    expect(a.superseded_by).toBe(SYNC('obs-race-b'))

    const { rows: live } = await pool.query(
      `select count(*)::int as n from observations o
        join projects pr on pr.id = o.project_id
       where pr.project_key = $1 and o.topic_key = 'deploy-target'
         and o.superseded_by is null and o.deleted = false`,
      [p]
    )
    expect(live[0].n).toBe(1) // exactly one live row survives, no matter who "won" the lock
  })
})
