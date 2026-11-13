import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

// The project-limit check reads how many projects the user already has and then decides
// whether a NEW project_key gets a slot. That read-then-write, if it runs in autocommit (no
// lock spanning both), is a classic TOCTOU: two concurrent pushes from the same user — two
// devices syncing at once, each introducing a different brand-new project — can both read
// "0 known projects" before either has inserted its row, both compute slotsLeft = 1, and
// both create a project. A Free account then has 2 projects in the cloud, which is exactly
// the invariant the limit exists to hold: the plan boundary must survive concurrent
// writers, not just sequential ones.
//
// A plain pair of concurrent pushes (Promise.all of exactly 2) did NOT reproduce this
// reliably against the pre-fix code on this machine — two round trips over localhost
// Postgres are fast enough that the two connections' `select` and `insert` did not
// reliably interleave across 3 straight runs. Fanning out to 8 concurrent pushes on a
// FRESH account (nobody else's timing to compete with) reproduced 2 applied out of 8,
// consistently, on the very first try, across 3 straight runs — see task-3-report.md for
// the RED output. Width, not repetition, is what makes this deterministic: it only takes
// ONE overlapping pair among the 8 to leave the account with 2 projects.
const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = (label: string) => `plimit-conc-${RUN}-${label}`

async function seed(plan: string) {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, $2)`, [userId, plan])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'plimit-conc', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  return { deviceId, userId, plan }
}

const mut = (seq: number, syncId: string, projectKey: string) => ({
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
    tags: [],
    lamport: 1,
    updated_at: Date.now(),
    created_at: Date.now(),
  },
})

beforeAll(async () => {
  await migrate(pool)
})
afterAll(async () => { await pool.end() })

// Warms N idle connections into the pool BEFORE the race. Without this, the first
// concurrent batch in a fresh vitest process pays TCP/handshake setup cost inside
// `pool.connect()`, and that setup is what serialized the 8 pushes enough for the race to
// stop reproducing (seen empirically: reliable with a warm pool, unreliable cold). Warming
// first means every `pool.connect()` below resolves from an idle connection already sitting
// in the pool, so the `select` queries actually land on the server close enough together to
// race — which is the whole point of this test.
async function warmPool(n: number) {
  const clients = await Promise.all(Array.from({ length: n }, () => pool.connect()))
  for (const c of clients) c.release()
}

describe('push — tope de proyectos bajo concurrencia', () => {
  it('N pushes simultaneos del mismo usuario Free, cada uno con un proyecto distinto, dejan un solo proyecto', async () => {
    const free = await seed('free')
    const N = 8
    await warmPool(N)

    const all = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        handlePush(pool, free, { mutations: [mut(i + 1, SYNC(`fan-${i}`), PROJECT(`fan-${i}`))] })
      )
    )

    const outcomes = all.map((r) => r.results[0])
    const applied = outcomes.filter((r) => r.outcome === 'applied')
    const rejected = outcomes.filter((r) => r.outcome === 'rejected')

    expect(applied).toHaveLength(1)
    expect(rejected).toHaveLength(N - 1)
    for (const r of rejected) expect(r).toMatchObject({ error: 'project_limit_reached' })

    const { rows } = await pool.query('select count(*)::int as n from projects where user_id = $1', [
      free.userId,
    ])
    expect(rows[0].n).toBe(1)
  })
})
