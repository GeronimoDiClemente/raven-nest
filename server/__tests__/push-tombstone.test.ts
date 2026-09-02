import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
let auth: { deviceId: string; userId: string; plan: string }

// The test DB persists between runs and observations.sync_id is a GLOBAL primary key, so a
// fixed literal like 'obs-del' collides with the row a previous run left behind. Prefix
// every sync_id with a per-run token, same discipline already used in push-topic.test.ts.
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'tomb', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId, plan: 'pro' }
})

afterAll(async () => { await pool.end() })

const base = (seq: number, syncId: string, projectKey: string, op: 'upsert' | 'delete', content: string | null) => ({
  seq, sync_id: syncId, op,
  payload: {
    sync_id: syncId, project_key: projectKey, project_display_name: projectKey,
    scope: 'personal', type: 'decision', topic_key: null, title: syncId,
    content, tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
  },
})

describe('tombstones (§8.2)', () => {
  it('accepts a delete and marks the row deleted with null content', async () => {
    const p = `tomb-${randomUUID().slice(0, 8)}`
    await handlePush(pool, auth, { mutations: [base(400, SYNC('obs-del'), p, 'upsert', 'alive')] })
    const res = await handlePush(pool, auth, { mutations: [base(401, SYNC('obs-del'), p, 'delete', null)] })

    // Positive on purpose: `not.toBe('rejected')` could never fail while nothing in the
    // handler assigned `rejected`. It can now, so the assertion has to name the outcome it
    // actually expects rather than the one it does not want.
    expect(res.results[0].outcome).toBe('applied')
    const { rows } = await pool.query(
      'select deleted, content from observations where sync_id = $1', [SYNC('obs-del')]
    )
    expect(rows[0].deleted).toBe(true)
    expect(rows[0].content).toBeNull()
  })

  it('a delete frees the topic slot for a later live row', async () => {
    const p = `tomb-${randomUUID().slice(0, 8)}`
    const withTopic = (seq: number, syncId: string, op: 'upsert' | 'delete') => ({
      seq, sync_id: syncId, op,
      payload: {
        sync_id: syncId, project_key: p, project_display_name: p, scope: 'personal',
        type: 'decision', topic_key: 'a-slot', title: syncId, content: op === 'delete' ? null : 'x',
        tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
      },
    })
    await handlePush(pool, auth, { mutations: [withTopic(500, SYNC('slot-1'), 'upsert')] })
    await handlePush(pool, auth, { mutations: [withTopic(501, SYNC('slot-1'), 'delete')] })
    const after = await handlePush(pool, auth, { mutations: [withTopic(502, SYNC('slot-2'), 'upsert')] })

    expect(after.results[0].outcome).toBe('applied')
  })

  it('a delete never gives a tombstone the topic slot of a live row', async () => {
    const p = `tomb-${randomUUID().slice(0, 8)}`
    const live = {
      seq: 600, sync_id: SYNC('live-row'), op: 'upsert' as const,
      payload: {
        sync_id: SYNC('live-row'), project_key: p, project_display_name: p, scope: 'personal',
        type: 'decision', topic_key: 'contested', title: 'live', content: 'x', tags: [],
        lamport: 1, updated_at: Date.now(), created_at: Date.now(),
      },
    }
    const tombstone = {
      seq: 601, sync_id: SYNC('dead-row'), op: 'delete' as const,
      payload: {
        sync_id: SYNC('dead-row'), project_key: p, project_display_name: p, scope: 'personal',
        type: 'decision', topic_key: 'contested', title: 'dead', content: null, tags: [],
        lamport: 99, updated_at: Date.now() + 60_000, created_at: Date.now(),
      },
    }
    await handlePush(pool, auth, { mutations: [live] })
    await handlePush(pool, auth, { mutations: [tombstone] })

    const { rows } = await pool.query(
      'select superseded_by from observations where sync_id = $1', [SYNC('live-row')]
    )
    expect(rows[0].superseded_by).toBeNull() // the live row keeps the slot
  })

  // Las siguientes dos cubren propiedades de `tombstoned_at` que hoy sólo viven en el SQL
  // del `on conflict` de push.ts (ronda de arreglo 2 de la Tarea 7). Van por handlePush de
  // punta a punta a propósito -- SQL directo no ejercita el `on conflict` real, que es
  // exactamente cómo el bug original de `server_created_at` se coló sin que ningún test lo
  // viera.

  it('reenviar el mismo delete no le renueva la vida al tombstone', async () => {
    const p = `tomb-${randomUUID().slice(0, 8)}`
    const syncId = SYNC('resend-del')
    await handlePush(pool, auth, { mutations: [base(800, syncId, p, 'upsert', 'alive')] })
    await handlePush(pool, auth, { mutations: [base(801, syncId, p, 'delete', null)] })
    const first = await pool.query(
      'select tombstoned_at from observations where sync_id = $1', [syncId]
    )
    const firstStamp = first.rows[0].tombstoned_at as Date
    expect(firstStamp).not.toBeNull()

    // Delay real, no simulado: si el coalesce estuviera del lado equivocado y reestampara
    // `now()` en cada escritura, dos llamadas a now() separadas por microsegundos podrían
    // coincidir por casualidad y esconder el bug. 50ms lo hace imposible de esconder.
    await new Promise((resolve) => setTimeout(resolve, 50))

    // El mismo delete, reenviado -- con un seq NUEVO, porque la idempotencia por
    // (device_id, seq) frenaría un replay del mismo seq antes de que llegue al upsert.
    await handlePush(pool, auth, { mutations: [base(802, syncId, p, 'delete', null)] })
    const second = await pool.query(
      'select tombstoned_at from observations where sync_id = $1', [syncId]
    )

    expect((second.rows[0].tombstoned_at as Date).getTime()).toBe(firstStamp.getTime())
  })

  it('resucitar una observacion borrada limpia tombstoned_at', async () => {
    const p = `tomb-${randomUUID().slice(0, 8)}`
    const syncId = SYNC('resurrect')
    await handlePush(pool, auth, { mutations: [base(810, syncId, p, 'upsert', 'alive')] })
    await handlePush(pool, auth, { mutations: [base(811, syncId, p, 'delete', null)] })
    const deleted = await pool.query(
      'select tombstoned_at from observations where sync_id = $1', [syncId]
    )
    expect(deleted.rows[0].tombstoned_at).not.toBeNull()

    await handlePush(pool, auth, { mutations: [base(812, syncId, p, 'upsert', 'de nuevo viva')] })
    const revived = await pool.query(
      'select deleted, tombstoned_at from observations where sync_id = $1', [syncId]
    )
    expect(revived.rows[0].deleted).toBe(false)
    expect(revived.rows[0].tombstoned_at).toBeNull()
  })
})
