import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { getPool, migrate } from '../src/db'
import { hashToken } from '../src/auth'
import { createApp } from '../src/http'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const TOKEN = `nmk_http_${RUN}`
let base: string
let server: ReturnType<typeof createApp>

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'http', $3)`,
    [deviceId, userId, hashToken(TOKEN)]
  )
  await pool.query('insert into allowlist (user_id) values ($1)', [userId])
  server = createApp(pool)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  await pool.end()
})

const post = (path: string, body: unknown, token = TOKEN) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('http', () => {
  it('serves /health without a token', async () => {
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
  })

  it('rejects a push with no token', async () => {
    const res = await fetch(`${base}/v1/sync/push`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
  })

  it('accepts a push with a good token', async () => {
    const res = await post('/v1/sync/push', { mutations: [] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [] })
  })

  it('serves the Supabase-shaped aliases (§5.4)', async () => {
    const res = await post('/functions/v1/memory-sync/push', { mutations: [] })
    expect(res.status).toBe(200)
  })

  it('refuses a batch over 500 with 413', async () => {
    // observations.sync_id is a global primary key and the test DB persists between runs.
    // This batch is rejected before handlePush ever runs, so nothing here is persisted
    // today — but prefix with RUN anyway so that stays true even if the 413 threshold or
    // the check's position ever changes.
    const mutations = Array.from({ length: 501 }, (_, i) => ({
      seq: 9000 + i, sync_id: `${RUN}-big-${i}`, op: 'upsert',
      payload: { sync_id: `${RUN}-big-${i}`, project_key: `${RUN}-big`, title: 't', lamport: 1, updated_at: Date.now() },
    }))
    const res = await post('/v1/sync/push', { mutations })
    expect(res.status).toBe(413)
  })

  it('serves status', async () => {
    const res = await fetch(`${base}/v1/sync/status`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    expect(res.status).toBe(200)
    expect((await res.json()).plan).toBe('pro')
  })

  it('404s an unknown route', async () => {
    expect((await post('/v1/sync/nope', {})).status).toBe(404)
  })

  it('400s a malformed body instead of crashing', async () => {
    const res = await fetch(`${base}/v1/sync/push`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})
