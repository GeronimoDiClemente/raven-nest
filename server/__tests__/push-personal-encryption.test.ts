// Hueco del 30-oct: el servicio aceptaba texto en claro PERSONAL de una cuenta que ya cifra
// (`users.key_epoch > 0`). El gate del cliente (`isEncryptionExpected`) lo frena en la app y
// en el paquete, pero un cliente viejo o con la época sin aprender lo subía igual. Mismo
// criterio que `team_encryption_required`: el servidor no guarda claro de una cuenta cifrada.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
let cifra: { deviceId: string; userId: string; plan: string }
let noCifra: { deviceId: string; userId: string; plan: string }
const proj = `ppe-${RUN}`

function mutation(seq: number, syncId: string, extra: Record<string, unknown> = {}, op: 'upsert' | 'delete' = 'upsert') {
  return {
    seq, sync_id: syncId, op,
    payload: {
      sync_id: syncId, project_key: proj, project_display_name: proj, scope: 'personal',
      type: 'decision', topic_key: null, title: 'titulo en claro', content: 'cuerpo en claro',
      tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(), ...extra,
    },
  }
}

const SELLADA = {
  title: 'nmc1:AAAA', content: 'nmc1:BBBB', tags: ['nmc1:CCCC'],
  project_display_name: 'nmc1:DDDD', content_hash: 'nmc1:EEEE', origin_account: 'nmc1:FFFF',
}

async function cuenta(keyEpoch: number) {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan, key_epoch) values ($1, 'cloud', $2)`, [userId, keyEpoch])
  await pool.query(`insert into devices (id, user_id, name, token_hash) values ($1, $2, 'd', $3)`, [deviceId, userId, `hash-${deviceId}`])
  return { deviceId, userId, plan: 'cloud' }
}

beforeAll(async () => {
  await migrate(pool)
  cifra = await cuenta(1)
  noCifra = await cuenta(0)
})

afterAll(async () => { await pool.end() })

describe('push — encryption_required (claro personal de una cuenta que cifra)', () => {
  it('una fila personal EN CLARO se rechaza y no se guarda', async () => {
    const res = await handlePush(pool, cifra, { mutations: [mutation(1, SYNC('claro'))] })
    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'encryption_required' })
    const { rows } = await pool.query('select 1 from observations where sync_id = $1', [SYNC('claro')])
    expect(rows).toHaveLength(0)
  })

  it('tags en claro también cuentan como texto en claro', async () => {
    const res = await handlePush(pool, cifra, { mutations: [mutation(2, SYNC('tags'), { ...SELLADA, tags: ['secreto'] })] })
    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'encryption_required' })
  })

  it('la misma fila sellada (nmc1:) se aplica', async () => {
    const res = await handlePush(pool, cifra, { mutations: [mutation(3, SYNC('sellada'), SELLADA)] })
    expect(res.results[0]).toMatchObject({ outcome: 'applied' })
  })

  it('un borrado (tombstone sin texto) pasa', async () => {
    const res = await handlePush(pool, cifra, {
      mutations: [mutation(4, SYNC('sellada'), { title: null, content: null, tags: [], project_display_name: 'nmc1:DDDD', content_hash: null, origin_account: null }, 'delete')],
    })
    expect(res.results[0].outcome).not.toBe('rejected')
  })

  it('el rechazo no crea el proyecto (no le ocupa el lugar a un Free)', async () => {
    const otra = await cuenta(1)
    const res = await handlePush(pool, otra, { mutations: [mutation(6, SYNC('sin-proyecto'))] })
    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'encryption_required' })
    const { rows } = await pool.query('select 1 from projects where user_id = $1', [otra.userId])
    expect(rows).toHaveLength(0)
  })
})

describe('sin ALLOW_PLAINTEXT_PERSONAL (producción)', () => {
  const antes = process.env.ALLOW_PLAINTEXT_PERSONAL
  beforeEach(() => { delete process.env.ALLOW_PLAINTEXT_PERSONAL })
  afterEach(() => { if (antes === undefined) delete process.env.ALLOW_PLAINTEXT_PERSONAL; else process.env.ALLOW_PLAINTEXT_PERSONAL = antes })

  it('una cuenta que NO cifra (época 0) tampoco puede subir en claro', async () => {
    const res = await handlePush(pool, noCifra, { mutations: [mutation(5, SYNC('epoca-0'))] })
    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'encryption_required' })
  })

  it('git_branch en claro cuenta como texto en claro', async () => {
    const res = await handlePush(pool, cifra, { mutations: [mutation(7, SYNC('rama'), { ...SELLADA, git_branch: 'feat/adquisicion-x' })] })
    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'encryption_required' })
  })
})

it('con ALLOW_PLAINTEXT_PERSONAL=1 (sólo tests) una cuenta en época 0 sube en claro', async () => {
  expect(process.env.ALLOW_PLAINTEXT_PERSONAL).toBe('1')
  const res = await handlePush(pool, noCifra, { mutations: [mutation(8, SYNC('permitido'))] })
  expect(res.results[0]).toMatchObject({ outcome: 'applied' })
})
