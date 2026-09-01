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

  it('400s valid JSON that is not an object, instead of 500ing on it', async () => {
    // `null` is the one that used to hurt: it parsed fine and then `body.mutations` threw a
    // TypeError inside the handler's try, which got reported as a 500. Bad client input
    // must not show up in the 500 channel — that channel is for OUR faults.
    for (const body of ['null', '42', '"a string"', '[]']) {
      const res = await fetch(`${base}/v1/sync/push`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body,
      })
      expect([body, res.status]).toEqual([body, 400])
    }
  })

  it('round-trips multibyte content in a body far larger than one chunk, byte-identically', async () => {
    // THE bug this test exists for: `data += chunk` decoded every ~64 KB Buffer on its
    // own, so any multibyte character straddling a chunk boundary became U+FFFD — in a
    // push that still answered `applied`, so the client marked it pushed and the damage
    // was permanent. 680 KB is the typical batch (200 mutations x ~3407 B), and the corpus
    // is Spanish markdown, so this was the DEFAULT case.
    const unit = 'ñandú «acentos» — em dash 🙂🎉 café · año\n'
    const content = unit.repeat(8000)
    const bytes = Buffer.byteLength(content, 'utf8')
    expect(bytes).toBeGreaterThan(400_000) // several chunks, guaranteed

    const project = `${RUN}-utf8`
    const syncId = `${RUN}-utf8-obs`
    const push = await post('/v1/sync/push', {
      mutations: [
        {
          seq: 7100,
          sync_id: syncId,
          op: 'upsert',
          payload: {
            sync_id: syncId, project_key: project, project_display_name: project,
            scope: 'personal', type: 'decision', topic_key: null,
            title: 'títulos con ñ y 🙂', content, tags: ['acentós', '🎉'],
            lamport: 1, updated_at: Date.now(), created_at: Date.now(),
          },
        },
      ],
    })
    expect(push.status).toBe(200)
    expect((await push.json()).results[0].outcome).toBe('applied')

    // What is actually STORED, not just what came back — a lossy decode on the way in is
    // invisible to a response that only echoes outcomes.
    const stored = await pool.query('select content, title, tags from observations where sync_id = $1', [syncId])
    expect(stored.rows[0].content).not.toContain('�')
    expect(Buffer.byteLength(stored.rows[0].content, 'utf8')).toBe(bytes)
    expect(Buffer.from(stored.rows[0].content, 'utf8').equals(Buffer.from(content, 'utf8'))).toBe(true)
    expect(stored.rows[0].title).toBe('títulos con ñ y 🙂')
    expect(stored.rows[0].tags).toEqual(['acentós', '🎉'])

    // And the whole way back out again.
    const pull = await post('/v1/sync/pull', { cursors: { [project]: 0 }, limit: 500 })
    const row = (await pull.json()).rows.find((r: { sync_id: string }) => r.sync_id === syncId)
    expect(row.content).not.toContain('�')
    expect(Buffer.from(row.content, 'utf8').equals(Buffer.from(content, 'utf8'))).toBe(true)
  })

  it('serves the §5.5 delete route and its Supabase-shaped alias', async () => {
    for (const path of ['/v1/sync/delete-data', '/functions/v1/memory-sync/delete-cloud-data']) {
      const res = await post(path, {})
      expect([path, res.status]).toEqual([path, 200])
      expect((await res.json()).ok).toBe(true)
    }
  })
})
