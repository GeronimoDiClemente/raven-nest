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

async function nuevaCuenta() {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'cloud')`, [userId])
  await pool.query(`insert into devices (id, user_id, name, token_hash) values ($1, $2, 'd', $3)`, [deviceId, userId, `hash-${deviceId}`])
  return { deviceId, userId, plan: 'cloud' }
}

beforeAll(async () => {
  await migrate(pool)
  auth = await nuevaCuenta()
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

  it('no cuenta filas de equipo: scope <> team', async () => {
    const a = await nuevaCuenta()
    await handlePush(pool, a, { mutations: [mutation(1, `${RUN}-eq`, 'personal')] })
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(1)
    await pool.query(`update observations set scope = 'team' where sync_id = $1`, [`${RUN}-eq`])
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(0)
  })

  it('no cuenta filas borradas aunque conserven el texto en claro: not deleted', async () => {
    const a = await nuevaCuenta()
    await handlePush(pool, a, { mutations: [mutation(1, `${RUN}-del`, 'personal')] })
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(1)
    // Por SQL y no por un `delete` de push: éste vacía título y contenido y no probaría nada.
    await pool.query(`update observations set deleted = true where sync_id = $1`, [`${RUN}-del`])
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(0)
  })

  it('un tombstone real subido por push tampoco cuenta', async () => {
    const a = await nuevaCuenta()
    await handlePush(pool, a, { mutations: [mutation(1, `${RUN}-tomb`, 'personal')] })
    await handlePush(pool, a, { mutations: [mutation(2, `${RUN}-tomb`, 'personal', { title: '', content: null }, 'delete')] })
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(0)
  })

  it('no cuenta filas de otra cuenta: p.user_id', async () => {
    const a = await nuevaCuenta()
    const b = await nuevaCuenta()
    await handlePush(pool, b, { mutations: [mutation(1, `${RUN}-ajena`, 'personal')] })
    expect((await handleStatus(pool, b)).plaintext_pending).toBe(1)
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(0)
  })

  // Una fila con UN solo campo en claro y todo lo demás sellado cuenta 1: cada rama del OR
  // tiene que poder disparar sola.
  const CASOS: Array<[string, Record<string, unknown>]> = [
    ['title', { title: 'plain' }],
    ['content', { content: 'plain' }],
    ['content_hash', { content_hash: 'plainhash' }],
    ['origin_account', { origin_account: 'plain@x.com' }],
    ['git_branch', { git_branch: 'main' }],
    ['tags con 2 elementos (uno sellado)', { tags: ['nmc1:CCCC', 'nmc1:HHHH'] }],
    ['tags con 1 elemento en claro', { tags: ['plain'] }],
  ]
  it.each(CASOS)('un solo campo en claro cuenta 1: %s', async (nombre, campo) => {
    const a = await nuevaCuenta()
    const id = `${RUN}-c-${nombre.replace(/\W/g, '')}`
    await handlePush(pool, a, { mutations: [mutation(1, id, 'personal', { ...SELLADA, ...campo })] })
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(1)
  })

  it('una fila toda sellada no cuenta', async () => {
    const a = await nuevaCuenta()
    await handlePush(pool, a, { mutations: [mutation(1, `${RUN}-ok`, 'personal', SELLADA)] })
    expect((await handleStatus(pool, a)).plaintext_pending).toBe(0)
  })
})
