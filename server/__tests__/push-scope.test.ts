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
  //
  // Team Memory Layer 1, Parte 4 added a SECOND gate on top of this one: the plan alone is
  // not enough, the project also has to be explicitly shared (`projects.team_id` set).
  // Without seeding that here, this test would now fail with `project_not_shared_with_team`
  // instead of pinning what it was written to pin — so the project is created with a
  // harmless personal push and shared directly via SQL before the real assertion.
  it('accepts a team-scoped memory from a plan that includes shared memory', async () => {
    const project = PROJECT('team')
    const teamId = randomUUID()
    await handlePush(pool, team, {
      mutations: [mutation(900, SYNC('team-team-scope-seed'), project)],
    })
    await pool.query('update projects set team_id = $1 where user_id = $2 and project_key = $3', [
      teamId, team.userId, project,
    ])

    const syncId = SYNC('team-team-scope')
    const res = await handlePush(pool, team, {
      device_id: team.deviceId,
      mutations: [mutation(1, syncId, project, { scope: 'team' })],
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

// Team Memory Layer 1, Parte 4 — `scope: 'team'` no sólo exige el plan (el gate de arriba):
// exige además que ESE project_key en particular esté compartido (`projects.team_id`
// seteado, la única vía es POST /v1/projects/share — ver projects-share.test.ts). El plan
// solo con la memoria compartida habilitada no basta si el usuario nunca compartió el
// proyecto puntual.
describe('push — team scope also requires the project itself to be shared (Parte 4)', () => {
  it('rejects scope:team when the project_key was never pushed before (no row in projects at all)', async () => {
    const syncId = SYNC('never-existed-team-scope')

    const res = await handlePush(pool, team, {
      mutations: [mutation(700, syncId, PROJECT('never-existed'), { scope: 'team' })],
    })

    expect(res.results[0]).toMatchObject({
      sync_id: syncId,
      outcome: 'rejected',
      error: 'project_not_shared_with_team',
    })
    const { rows } = await pool.query('select scope from observations where sync_id = $1', [syncId])
    expect(rows).toHaveLength(0)
  })

  it('rejects scope:team when the project exists but was never shared (team_id is null)', async () => {
    const project = PROJECT('exists-unshared')
    // Crea la fila en `projects` sin tocar team_id — sigue en NULL, el default.
    await handlePush(pool, team, {
      mutations: [mutation(701, SYNC('exists-unshared-seed'), project)],
    })

    const syncId = SYNC('exists-unshared-team-scope')
    const res = await handlePush(pool, team, {
      mutations: [mutation(702, syncId, project, { scope: 'team' })],
    })

    expect(res.results[0]).toMatchObject({
      sync_id: syncId,
      outcome: 'rejected',
      error: 'project_not_shared_with_team',
    })
    const { rows } = await pool.query('select scope from observations where sync_id = $1', [syncId])
    expect(rows).toHaveLength(0)
  })

  it('accepts scope:team once the project has team_id set', async () => {
    const project = PROJECT('shared-directly')
    const teamId = randomUUID()
    await handlePush(pool, team, {
      mutations: [mutation(703, SYNC('shared-directly-seed'), project)],
    })
    await pool.query('update projects set team_id = $1 where user_id = $2 and project_key = $3', [
      teamId, team.userId, project,
    ])

    const syncId = SYNC('shared-directly-team-scope')
    const res = await handlePush(pool, team, {
      mutations: [mutation(704, syncId, project, { scope: 'team' })],
    })

    expect(res.results[0]).toMatchObject({ sync_id: syncId, outcome: 'applied' })
  })
})
