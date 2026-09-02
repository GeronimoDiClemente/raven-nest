import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = (label: string) => `plimit-${RUN}-${label}`

let free: { deviceId: string; userId: string; plan: string }

async function seed(plan: string) {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, $2)`, [userId, plan])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'plimit', $3)`,
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
  free = await seed('free')
})
afterAll(async () => { await pool.end() })

describe('push — tope de proyectos por plan', () => {
  it('deja al primer proyecto de un plan Free y rechaza el segundo', async () => {
    const first = await handlePush(pool, free, {
      mutations: [mut(1, SYNC('p1'), PROJECT('uno'))],
    })
    expect(first.results[0].outcome).toBe('applied')

    const second = await handlePush(pool, free, {
      mutations: [mut(2, SYNC('p2'), PROJECT('dos'))],
    })
    expect(second.results[0]).toMatchObject({
      outcome: 'rejected',
      error: 'project_limit_reached',
    })

    // El proyecto de mas no se crea: la cuenta sigue teniendo uno solo.
    const { rows } = await pool.query('select count(*)::int as n from projects where user_id = $1', [
      free.userId,
    ])
    expect(rows[0].n).toBe(1)
  })

  it('sigue aceptando escrituras en el proyecto que ya esta en la nube', async () => {
    const res = await handlePush(pool, free, {
      mutations: [mut(3, SYNC('p3'), PROJECT('uno'))],
    })
    expect(res.results[0].outcome).toBe('applied')
  })

  it('no le pone el tope de Free a una cuenta Cloud', async () => {
    const cloud = await seed('cloud')
    await handlePush(pool, cloud, { mutations: [mut(1, SYNC('c1'), PROJECT('c-uno'))] })
    const res = await handlePush(pool, cloud, {
      mutations: [mut(2, SYNC('c2'), PROJECT('c-dos'))],
    })
    expect(res.results[0].outcome).toBe('applied')
  })
})
