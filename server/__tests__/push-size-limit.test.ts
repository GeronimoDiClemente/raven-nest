import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = `size-${RUN}`

let auth: { deviceId: string; userId: string; plan: string }

const mut = (seq: number, syncId: string, content: string) => ({
  seq,
  sync_id: syncId,
  op: 'upsert' as const,
  payload: {
    sync_id: syncId,
    project_key: PROJECT,
    project_display_name: PROJECT,
    scope: 'personal',
    type: 'decision',
    topic_key: null,
    title: 'a title',
    content,
    tags: [],
    lamport: 1,
    updated_at: Date.now(),
    created_at: Date.now(),
  },
})

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'size', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId, plan: 'pro' }
})
afterAll(async () => { await pool.end() })

describe('push — tope de tamaño por observación', () => {
  it('rechaza una observacion de mas de 1 MB sin escribirla', async () => {
    const syncId = SYNC('gorda')
    const res = await handlePush(pool, auth, {
      mutations: [mut(1, syncId, 'x'.repeat(1024 * 1024 + 1))],
    })

    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'observation_too_large' })
    const { rows } = await pool.query('select 1 from observations where sync_id = $1', [syncId])
    expect(rows).toHaveLength(0)
  })

  it('acepta una observacion justo en el limite', async () => {
    const syncId = SYNC('justa')
    const res = await handlePush(pool, auth, {
      mutations: [mut(2, syncId, 'x'.repeat(1024 * 1024))],
    })
    expect(res.results[0].outcome).toBe('applied')
  })

  // El tope se mide en BYTES, no en caracteres: el mismo texto en espanol pesa mas.
  it('mide bytes utf-8, no unidades de utf-16', async () => {
    const syncId = SYNC('multibyte')
    // 'ñ' son 2 bytes en utf-8 y 1 unidad en utf-16: 600k caracteres = 1,2 MB.
    const res = await handlePush(pool, auth, {
      mutations: [mut(3, syncId, 'ñ'.repeat(600_000))],
    })
    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'observation_too_large' })
  })
})
