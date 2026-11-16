// N1 (re-review del cifrado obligatorio): el upsert por sync_id no miraba lamport. Una máquina
// que no tenía la clave conserva versiones viejas de filas que otra editó o borró, y el
// re-upload al adoptar las subía tal cual: pisaba la edición nueva en la nube o resucitaba el
// borrado. Una mutación más vieja que la fila guardada es un no-op que el cliente da por hecho
// (`stale`, que no es `rejected`): no se reintenta y no se marca como error.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const proj = `lg-${RUN}`
let auth: { deviceId: string; userId: string; plan: string }
let seq = 0
// Por defecto el reloj avanza con el lamport: una versión "más vieja" lo es por los dos lados,
// que es el caso de N1. Los tests de R1 pasan `updated_at` explícito para separarlos.
const BASE = Date.now()

const SELLADA = {
  title: 'nmc1:AAAA', content: 'nmc1:BBBB', tags: ['nmc1:CCCC'],
  project_display_name: 'nmc1:DDDD', content_hash: 'nmc1:EEEE', origin_account: 'nmc1:FFFF', git_branch: 'nmc1:GGGG',
}

function mutation(syncId: string, lamport: number, extra: Record<string, unknown> = {}, op: 'upsert' | 'delete' = 'upsert') {
  seq += 1
  return {
    seq, sync_id: syncId, op,
    payload: {
      sync_id: syncId, project_key: proj, project_display_name: proj, scope: 'personal',
      type: 'decision', topic_key: null, title: 'plain title', content: 'plain body',
      tags: [], lamport, updated_at: BASE + lamport * 1000, created_at: BASE, ...extra,
    },
  }
}

async function fila(syncId: string) {
  const { rows } = await pool.query(
    'select title, content, lamport, deleted, project_seq from observations where sync_id = $1', [syncId]
  )
  return rows[0] as { title: string; content: string | null; lamport: string; deleted: boolean; project_seq: string }
}

async function cursorDelProyecto(): Promise<number> {
  const { rows } = await pool.query(
    `select coalesce(max(o.project_seq), 0) as m from observations o
       join projects p on p.id = o.project_id where p.user_id = $1 and p.project_key = $2`,
    [auth.userId, proj]
  )
  return Number(rows[0].m)
}

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'cloud')`, [userId])
  await pool.query(`insert into devices (id, user_id, name, token_hash) values ($1, $2, 'lg', $3)`, [deviceId, userId, `hash-${deviceId}`])
  auth = { deviceId, userId, plan: 'cloud' }
})
afterAll(async () => { await pool.end() })

describe('push — guarda de LWW (N1, R1)', () => {
  it('un upsert más viejo no pisa la fila más nueva, y vuelve como stale sin mover project_seq', async () => {
    const id = `${RUN}-viejo`
    await handlePush(pool, auth, { mutations: [mutation(id, 5, { title: 'v5', content: 'old' })] })
    await handlePush(pool, auth, { mutations: [mutation(id, 10, { title: 'v10', content: 'new' })] })
    const antes = await fila(id)
    const cursorAntes = await cursorDelProyecto()

    const res = await handlePush(pool, auth, { mutations: [mutation(id, 5, { title: 'v5', content: 'old' })] })

    expect(res.results).toHaveLength(1)
    expect(res.results[0].outcome).toBe('stale')
    const despues = await fila(id)
    expect(despues.title).toBe('v10')
    expect(despues.content).toBe('new')
    expect(Number(despues.lamport)).toBe(10)
    // El no-op no le da a la fila un project_seq nuevo: un pull no la vuelve a bajar.
    expect(despues.project_seq).toBe(antes.project_seq)
    expect(await cursorDelProyecto()).toBe(cursorAntes)
    expect(Number(res.results[0].project_seq)).toBe(Number(antes.project_seq))
  })

  it('el replay de un stale devuelve stale (idempotencia por recibo)', async () => {
    const id = `${RUN}-replay`
    await handlePush(pool, auth, { mutations: [mutation(id, 10)] })
    const vieja = mutation(id, 3)
    const a = await handlePush(pool, auth, { mutations: [vieja] })
    const b = await handlePush(pool, auth, { mutations: [vieja] })
    expect(a.results[0].outcome).toBe('stale')
    expect(b.results[0].outcome).toBe('stale')
  })

  it('un upsert más viejo no resucita un borrado más nuevo', async () => {
    const id = `${RUN}-resu`
    await handlePush(pool, auth, { mutations: [mutation(id, 5)] })
    await handlePush(pool, auth, { mutations: [mutation(id, 10, { title: '', content: null }, 'delete')] })

    const res = await handlePush(pool, auth, { mutations: [mutation(id, 5, SELLADA)] })

    expect(res.results[0].outcome).toBe('stale')
    const r = await fila(id)
    expect(r.deleted).toBe(true)
    expect(r.title).toBe('')
    expect(r.content).toBeNull()
  })

  it('un borrado más viejo no mata una fila más nueva', async () => {
    const id = `${RUN}-matar`
    await handlePush(pool, auth, { mutations: [mutation(id, 10, { title: 'alive' })] })

    const res = await handlePush(pool, auth, { mutations: [mutation(id, 4, { title: '', content: null }, 'delete')] })

    expect(res.results[0].outcome).toBe('stale')
    const r = await fila(id)
    expect(r.deleted).toBe(false)
    expect(r.title).toBe('alive')
  })

  it('con el MISMO lamport, el re-upload sellado reemplaza a la fila en claro', async () => {
    const id = `${RUN}-igual`
    await handlePush(pool, auth, { mutations: [mutation(id, 7)] })

    const res = await handlePush(pool, auth, { mutations: [mutation(id, 7, SELLADA)] })

    expect(res.results[0].outcome).toBe('applied')
    const r = await fila(id)
    expect(r.title).toBe('nmc1:AAAA')
    expect(r.content).toBe('nmc1:BBBB')
  })

  // R1 (re-review de N1): la guarda ordena IGUAL que resolveLWW del cliente (memory-merge.ts) y
  // la colisión de temas (lww.ts): updated_at primero, lamport después. Una máquina atrasada en
  // el pull edita MÁS TARDE con un lamport MÁS BAJO; si el servidor la descartara como stale,
  // ella conservaría su versión (gana por updated_at en su LWW local) y la nube la de la otra:
  // divergencia permanente.
  it('updated_at más nuevo con lamport más bajo se aplica (máquina atrasada en el pull)', async () => {
    const id = `${RUN}-atrasada`
    const t0 = Date.parse('2026-11-02T10:00:00Z')
    await handlePush(pool, auth, { mutations: [mutation(id, 1000, { title: 'de A', updated_at: t0 })] })

    const res = await handlePush(pool, auth, { mutations: [mutation(id, 991, { title: 'de B', updated_at: t0 + 60_000 })] })

    expect(res.results[0].outcome).toBe('applied')
    expect((await fila(id)).title).toBe('de B')
  })

  it('updated_at más viejo con lamport más alto es stale (el orden es updated_at primero)', async () => {
    const id = `${RUN}-reloj`
    const t0 = Date.parse('2026-11-02T10:00:00Z')
    await handlePush(pool, auth, { mutations: [mutation(id, 5, { title: 'nueva', updated_at: t0 + 60_000 })] })

    const res = await handlePush(pool, auth, { mutations: [mutation(id, 50, { title: 'vieja', updated_at: t0 })] })

    expect(res.results[0].outcome).toBe('stale')
    expect((await fila(id)).title).toBe('nueva')
  })

  it('mismo updated_at y mismo lamport (re-upload sellado) se aplica', async () => {
    const id = `${RUN}-empate-total`
    const t0 = Date.parse('2026-11-02T10:00:00.123Z')
    await handlePush(pool, auth, { mutations: [mutation(id, 7, { updated_at: t0 })] })
    const res = await handlePush(pool, auth, { mutations: [mutation(id, 7, { ...SELLADA, updated_at: t0 })] })
    expect(res.results[0].outcome).toBe('applied')
    expect((await fila(id)).title).toBe('nmc1:AAAA')
  })

  it('un upsert más nuevo sigue pisando, como siempre', async () => {
    const id = `${RUN}-nuevo`
    await handlePush(pool, auth, { mutations: [mutation(id, 2, { title: 'a' })] })
    const res = await handlePush(pool, auth, { mutations: [mutation(id, 3, { title: 'b' })] })
    expect(res.results[0].outcome).toBe('applied')
    expect((await fila(id)).title).toBe('b')
  })

  it('un stale con tema no supersede a la dueña viva del tema', async () => {
    const id = `${RUN}-tema-viejo`
    const duena = `${RUN}-tema-duena`
    const topic = `tema-${RUN}`
    // `id` sube primero con lamport 10, después la pisa la dueña del tema (más nueva por LWW) y
    // queda superseded. Un snapshot viejo de `id` (lamport 2) no tiene que pelear el tema.
    await handlePush(pool, auth, { mutations: [mutation(id, 10, { topic_key: topic })] })
    await handlePush(pool, auth, { mutations: [mutation(duena, 50, { topic_key: topic })] })
    const { rows: antes } = await pool.query('select superseded_by from observations where sync_id = $1', [duena])
    expect(antes[0].superseded_by).toBeNull()

    const res = await handlePush(pool, auth, { mutations: [mutation(id, 2, { topic_key: topic })] })

    expect(res.results[0].outcome).toBe('stale')
    const { rows } = await pool.query('select superseded_by from observations where sync_id = $1', [duena])
    expect(rows[0].superseded_by).toBeNull()
  })
})
