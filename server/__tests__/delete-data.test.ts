import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { getPool, migrate } from '../src/db'
import { hashToken } from '../src/auth'
import { createApp } from '../src/http'
import { handlePush } from '../src/push'
import { handleDeleteData } from '../src/delete-data'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = (label: string) => `del-${RUN}-${label}`

let mine: { deviceId: string; userId: string; plan: string }
let theirs: { deviceId: string; userId: string; plan: string }
let base: string
let server: ReturnType<typeof createApp>
const TOKEN = `nmk_del_${RUN}`

async function seedAccount(label: string, token?: string) {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)`,
    [deviceId, userId, label, token ? hashToken(token) : `hash-${deviceId}`]
  )
  await pool.query('insert into allowlist (user_id) values ($1)', [userId])
  return { deviceId, userId, plan: 'pro' }
}

const mutation = (seq: number, syncId: string, projectKey: string) => ({
  seq, sync_id: syncId, op: 'upsert' as const,
  payload: {
    sync_id: syncId, project_key: projectKey, project_display_name: projectKey,
    scope: 'personal', type: 'decision', topic_key: null, title: syncId,
    content: 'contenido', tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
  },
})

const countsFor = async (userId: string) => {
  const obs = await pool.query(
    `select count(*)::int as n from observations o join projects p on p.id = o.project_id
      where p.user_id = $1`,
    [userId]
  )
  const projects = await pool.query('select count(*)::int as n from projects where user_id = $1', [userId])
  const receipts = await pool.query(
    `select count(*)::int as n from push_receipts r join devices d on d.id = r.device_id
      where d.user_id = $1`,
    [userId]
  )
  return { observations: obs.rows[0].n, projects: projects.rows[0].n, receipts: receipts.rows[0].n }
}

beforeAll(async () => {
  await migrate(pool)
  mine = await seedAccount('mine', TOKEN)
  theirs = await seedAccount('theirs')
  server = createApp(pool)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  await pool.end()
})

describe('§5.5 delete-data — the right to delete', () => {
  it("deletes every trace of the caller and nothing of anyone else's", async () => {
    await handlePush(pool, mine, {
      mutations: [
        mutation(3000, SYNC('mine-1'), PROJECT('mine-a')),
        mutation(3001, SYNC('mine-2'), PROJECT('mine-a')),
        mutation(3002, SYNC('mine-3'), PROJECT('mine-b')),
      ],
    })
    await handlePush(pool, theirs, {
      mutations: [mutation(3000, SYNC('theirs-1'), PROJECT('theirs'))],
    })

    const before = { mine: await countsFor(mine.userId), theirs: await countsFor(theirs.userId) }
    expect(before.mine).toEqual({ observations: 3, projects: 2, receipts: 3 })
    expect(before.theirs).toEqual({ observations: 1, projects: 1, receipts: 1 })

    const res = await handleDeleteData(pool, mine)
    expect(res).toEqual({ ok: true, deleted: { observations: 3, projects: 2, push_receipts: 3 } })

    expect(await countsFor(mine.userId)).toEqual({ observations: 0, projects: 0, receipts: 0 })
    // The other tenant is untouched — the assertion the whole endpoint lives or dies on.
    expect(await countsFor(theirs.userId)).toEqual(before.theirs)
    const survivor = await pool.query('select content from observations where sync_id = $1', [SYNC('theirs-1')])
    expect(survivor.rows[0].content).toBe('contenido')

    // The account and its device survive: this is "delete my cloud data", not "delete my
    // account", and the token the caller just used has to keep working.
    const user = await pool.query('select count(*)::int as n from users where id = $1', [mine.userId])
    const device = await pool.query('select count(*)::int as n from devices where id = $1', [mine.deviceId])
    expect(user.rows[0].n).toBe(1)
    expect(device.rows[0].n).toBe(1)
  })

  it('is idempotent — a second delete is a no-op, not an error', async () => {
    const res = await handleDeleteData(pool, mine)
    expect(res).toEqual({ ok: true, deleted: { observations: 0, projects: 0, push_receipts: 0 } })
  })

  it('serves both routes over HTTP and refuses an unauthenticated one', async () => {
    // The client (electron/main.ts) still posts to the Supabase-shaped path with a body of
    // `{}` and only reads `res.ok` — a 404 there means the user is told their cloud copy
    // is gone while it is still there.
    await handlePush(pool, mine, { mutations: [mutation(3100, SYNC('http-1'), PROJECT('http'))] })

    const unauth = await fetch(`${base}/functions/v1/memory-sync/delete-cloud-data`, {
      method: 'POST',
      body: '{}',
    })
    expect(unauth.status).toBe(401)
    expect(await countsFor(mine.userId)).toMatchObject({ observations: 1 })

    const res = await fetch(`${base}/functions/v1/memory-sync/delete-cloud-data`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deleted: { observations: 1, projects: 1, push_receipts: 1 } })
    expect(await countsFor(mine.userId)).toEqual({ observations: 0, projects: 0, receipts: 0 })

    const canonical = await fetch(`${base}/v1/sync/delete-data`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(canonical.status).toBe(200)
    expect((await canonical.json()).ok).toBe(true)
  })
})
