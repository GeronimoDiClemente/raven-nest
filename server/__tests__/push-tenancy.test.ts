import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
let alice: { deviceId: string; userId: string; plan: string }
let bob: { deviceId: string; userId: string; plan: string }

// The test DB persists between runs and observations.sync_id is a GLOBAL primary key —
// which is the very thing this file is about — so every id here is per-run.
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = (label: string) => `tenancy-${RUN}-${label}`

async function seedAccount(label: string) {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)`,
    [deviceId, userId, label, `hash-${deviceId}`]
  )
  return { deviceId, userId, plan: 'pro' }
}

beforeAll(async () => {
  await migrate(pool)
  alice = await seedAccount('alice')
  bob = await seedAccount('bob')
})

afterAll(async () => { await pool.end() })

function mutation(
  seq: number,
  syncId: string,
  projectKey: string,
  extra: Record<string, unknown> = {}
) {
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
      tags: [],
      lamport: 1,
      updated_at: Date.now(),
      created_at: Date.now(),
      ...extra,
    },
  }
}

describe('sync_id tenancy and a complete upsert SET list', () => {
  it("rejects a push carrying another account's sync_id, and leaves that row untouched", async () => {
    // Not a hypothetical "guess an id" attack: `deriveImportSyncId` in
    // electron/memory-store.ts derives sync_id from (projectKey, scope, type, contentHash,
    // topicKey) with NO per-user salt, so two accounts importing the same memory collide
    // by construction. The old SET list did `do update` across the tenancy boundary:
    // Alice's content was overwritten, Bob's own memory was lost, and Bob got `applied`.
    const shared = SYNC('collision')
    const aliceProject = PROJECT('alice')
    const bobProject = PROJECT('bob')

    const mine = await handlePush(pool, alice, {
      mutations: [mutation(1000, shared, aliceProject, { content: 'de alice', title: 'alice' })],
    })
    expect(mine.results[0].outcome).toBe('applied')

    const theirs = await handlePush(pool, bob, {
      mutations: [mutation(1000, shared, bobProject, { content: 'de bob', title: 'bob' })],
    })
    expect(theirs.results[0]).toMatchObject({
      sync_id: shared,
      outcome: 'rejected',
      error: 'sync_id_conflict',
    })

    const { rows } = await pool.query(
      `select o.content, o.title, o.author_id, p.project_key
         from observations o join projects p on p.id = o.project_id
        where o.sync_id = $1`,
      [shared]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe('de alice')
    expect(rows[0].title).toBe('alice')
    expect(rows[0].author_id).toBe(alice.userId)
    expect(rows[0].project_key).toBe(aliceProject)

    // Terminal, so it must not leave a receipt claiming it worked either.
    const receipts = await pool.query(
      'select count(*)::int as n from push_receipts where device_id = $1 and seq = $2',
      [bob.deviceId, 1000]
    )
    expect(receipts.rows[0].n).toBe(0)
  })

  it('clears a stale superseded_by when a re-pushed row wins its topic back', async () => {
    // Without `superseded_by = excluded.superseded_by` in the SET list this ends as a
    // CYCLE — A says B superseded it, B says A did — which means zero live owners for the
    // topic and the memory disappearing from the active view on every machine.
    const p = PROJECT('cycle')
    const now = Date.now()
    const a = SYNC('cycle-a')
    const b = SYNC('cycle-b')
    const topic = { topic_key: 'deploy-target' }

    await handlePush(pool, alice, {
      mutations: [mutation(1100, a, p, { ...topic, updated_at: now, lamport: 1 })],
    })
    await handlePush(pool, alice, {
      mutations: [mutation(1101, b, p, { ...topic, updated_at: now + 60_000, lamport: 2 })],
    })
    // A comes back as the LWW winner (later clock, higher lamport) under its own sync_id.
    const won = await handlePush(pool, alice, {
      mutations: [mutation(1102, a, p, { ...topic, updated_at: now + 120_000, lamport: 3 })],
    })
    expect(won.results[0].outcome).toBe('applied')

    const { rows } = await pool.query(
      'select sync_id, superseded_by from observations where sync_id in ($1, $2)',
      [a, b]
    )
    expect(rows).toHaveLength(2) // nothing discarded
    expect(rows.find((r) => r.sync_id === a).superseded_by).toBeNull()
    expect(rows.find((r) => r.sync_id === b).superseded_by).toBe(a)

    const { rows: live } = await pool.query(
      `select o.sync_id from observations o join projects p on p.id = o.project_id
        where p.project_key = $1 and o.topic_key = 'deploy-target'
          and o.deleted = false and o.superseded_by is null`,
      [p]
    )
    expect(live.map((r) => r.sync_id)).toEqual([a]) // exactly one live owner, and it is A
  })

  it('moves a row to its new project when the project_key changes', async () => {
    // `project_seq = excluded.project_seq` was in the SET list without `project_id`, so a
    // repo re-cloned to a different path left the row in its OLD project holding a seq
    // drawn from the NEW project's counter — a violation of unique (project_id,
    // project_seq) that omitted the mutation and retried it forever, invisibly.
    const syncId = SYNC('moved')
    const from = PROJECT('from')
    const to = PROJECT('to')

    await handlePush(pool, alice, { mutations: [mutation(1200, syncId, from)] })
    const moved = await handlePush(pool, alice, { mutations: [mutation(1201, syncId, to)] })
    expect(moved.results[0].outcome).toBe('applied')

    const { rows } = await pool.query(
      `select p.project_key, o.project_seq, p.seq_counter
         from observations o join projects p on p.id = o.project_id
        where o.sync_id = $1`,
      [syncId]
    )
    expect(rows[0].project_key).toBe(to)
    // And the seq it carries belongs to the project it now lives in.
    expect(Number(rows[0].project_seq)).toBe(moved.results[0].project_seq)
    expect(Number(rows[0].project_seq)).toBeLessThanOrEqual(Number(rows[0].seq_counter))
  })
})
