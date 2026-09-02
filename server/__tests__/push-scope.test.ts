import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

// `scope: 'team'` is what makes a memory visible to other people in the account. The wire
// contract lets the client send it on any mutation, so the ONLY thing standing between a
// personal memory and a shared one is the server: whatever the payload says, a user whose
// plan does not include shared memory must not be able to write one.
const pool = getPool()

const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = (label: string) => `scope-${RUN}-${label}`

let solo: { deviceId: string; userId: string; plan: string }
let team: { deviceId: string; userId: string; plan: string }

async function seedAccount(label: string, plan: string) {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, $2)`, [userId, plan])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)`,
    [deviceId, userId, label, `hash-${deviceId}`]
  )
  return { deviceId, userId, plan }
}

beforeAll(async () => {
  await migrate(pool)
  solo = await seedAccount('solo', 'pro')
  team = await seedAccount('team', 'team')
})

afterAll(async () => {
  await pool.end()
})

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

describe('push — the team scope is gated by plan', () => {
  it('rejects a team-scoped memory from a plan without shared memory', async () => {
    const syncId = SYNC('solo-team-scope')

    const res = await handlePush(pool, solo, {
      device_id: solo.deviceId,
      mutations: [mutation(1, syncId, PROJECT('solo'), { scope: 'team' })],
    })

    expect(res.results[0]).toMatchObject({
      sync_id: syncId,
      outcome: 'rejected',
      error: 'team_scope_not_allowed',
    })

    // Rejected must mean nothing was written, not "written and reported as refused".
    const { rows } = await pool.query('select scope from observations where sync_id = $1', [syncId])
    expect(rows).toHaveLength(0)
  })

  // Pins the other half of the gate: an implementation that simply refused every
  // team-scoped write would pass the test above and still be wrong.
  it('accepts a team-scoped memory from a plan that includes shared memory', async () => {
    const syncId = SYNC('team-team-scope')

    const res = await handlePush(pool, team, {
      device_id: team.deviceId,
      mutations: [mutation(1, syncId, PROJECT('team'), { scope: 'team' })],
    })

    expect(res.results[0]).toMatchObject({ sync_id: syncId, outcome: 'applied' })

    const { rows } = await pool.query('select scope from observations where sync_id = $1', [syncId])
    expect(rows[0]?.scope).toBe('team')
  })

  it('rejects only the team-scoped mutation, not the rest of the batch', async () => {
    const refused = SYNC('batch-team')
    const kept = SYNC('batch-personal')

    const res = await handlePush(pool, solo, {
      device_id: solo.deviceId,
      mutations: [
        mutation(2, refused, PROJECT('solo'), { scope: 'team' }),
        mutation(3, kept, PROJECT('solo')),
      ],
    })

    expect(res.results.find((r) => r.sync_id === refused)?.outcome).toBe('rejected')
    expect(res.results.find((r) => r.sync_id === kept)?.outcome).toBe('applied')
  })
})
