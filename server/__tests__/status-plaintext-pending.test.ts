// Spec 2026-11-02 §4: cuánto sigue en claro en la nube, para que el cliente sepa si la
// migración terminó. Una fila re-subida sellada con el mismo sync_id deja de contar.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'
import { handleStatus } from '../src/status'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
let auth: { deviceId: string; userId: string; plan: string }
const proj = `spp-${RUN}`

const SELLADA = {
  title: 'nmc1:AAAA', content: 'nmc1:BBBB', tags: ['nmc1:CCCC'],
  project_display_name: 'nmc1:DDDD', content_hash: 'nmc1:EEEE', origin_account: 'nmc1:FFFF', git_branch: 'nmc1:GGGG',
}
function mutation(seq: number, syncId: string, scope: string, extra: Record<string, unknown> = {}, op: 'upsert' | 'delete' = 'upsert') {
  return {
    seq, sync_id: syncId, op,
    payload: {
      sync_id: syncId, project_key: proj, project_display_name: proj, scope,
      type: 'decision', topic_key: null, title: 'plain title', content: 'plain body',
      tags: [], lamport: seq, updated_at: Date.now(), created_at: Date.now(), ...extra,
    },
  }
}

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'cloud')`, [userId])
  await pool.query(`insert into devices (id, user_id, name, token_hash) values ($1, $2, 'd', $3)`, [deviceId, userId, `hash-${deviceId}`])
  auth = { deviceId, userId, plan: 'cloud' }
})
afterAll(async () => { await pool.end() })

describe('status — plaintext_pending', () => {
  it('cuenta las filas personales en claro y deja de contarlas al re-subirlas selladas', async () => {
    expect((await handleStatus(pool, auth)).plaintext_pending).toBe(0)
    await handlePush(pool, auth, { mutations: [mutation(1, `${RUN}-a`, 'personal'), mutation(2, `${RUN}-b`, 'personal')] })
    expect((await handleStatus(pool, auth)).plaintext_pending).toBe(2)

    await handlePush(pool, auth, { mutations: [mutation(3, `${RUN}-a`, 'personal', SELLADA)] })
    expect((await handleStatus(pool, auth)).plaintext_pending).toBe(1)
  })

  it('no cuenta filas de equipo ni borradas', async () => {
    const antes = (await handleStatus(pool, auth)).plaintext_pending
    await handlePush(pool, auth, { mutations: [mutation(4, `${RUN}-borrada`, 'personal')] })
    await handlePush(pool, auth, { mutations: [mutation(5, `${RUN}-borrada`, 'personal', { title: '', content: null }, 'delete')] })
    expect((await handleStatus(pool, auth)).plaintext_pending).toBe(antes)
  })
})
