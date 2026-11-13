// Spec 2b-2 §4.7 contra Postgres real: la regla del push, POST /v1/projects/keep y status.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'
import { handleStatus } from '../src/status'
import { handleKeepProject } from '../src/keep'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const GLOBAL = '__global__'
let seq = 0

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })

async function seed(plan: string) {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query('insert into users (id, plan) values ($1, $2)', [userId, plan])
  await pool.query(`insert into devices (id, user_id, name, token_hash) values ($1, $2, 'keep', $3)`, [deviceId, userId, `hash-${deviceId}`])
  return { deviceId, userId, plan }
}

const mut = (projectKey: string) => {
  const syncId = `${RUN}-keep-${++seq}`
  return {
    seq, sync_id: syncId, op: 'upsert' as const,
    payload: {
      sync_id: syncId, project_key: projectKey, project_display_name: projectKey, scope: 'personal',
      type: 'decision', topic_key: null, title: 't', content: 'c', tags: [], lamport: 1,
      updated_at: Date.now(), created_at: Date.now(),
    },
  }
}

const empujar = async (auth: { deviceId: string; userId: string; plan: string }, key: string) =>
  (await handlePush(pool, auth, { mutations: [mut(key)] })).results[0]

/** Cuenta Cloud con tres proyectos (en orden de alta A, B, C) que baja a Free. */
async function bajadaConTres() {
  const cloud = await seed('cloud')
  const [A, B, C] = ['a', 'b', 'c'].map((x) => `${RUN}-${x}-${cloud.userId.slice(0, 4)}`)
  for (const k of [A, B, C]) expect((await empujar(cloud, k)).outcome).toBe('applied')
  await pool.query(`update users set plan = 'free' where id = $1`, [cloud.userId])
  return { free: { ...cloud, plan: 'free' }, A, B, C }
}

describe('push con más proyectos que el tope', () => {
  it('sin elección pasa sólo el más viejo; __global__ siempre pasa', async () => {
    const { free, A, B, C } = await bajadaConTres()
    expect((await empujar(free, A)).outcome).toBe('applied')
    expect(await empujar(free, B)).toMatchObject({ outcome: 'rejected', error: 'project_limit_reached' })
    expect(await empujar(free, C)).toMatchObject({ outcome: 'rejected', error: 'project_limit_reached' })
    expect((await empujar(free, GLOBAL)).outcome).toBe('applied')
  })

  it('con elección pasa sólo el elegido', async () => {
    const { free, A, B } = await bajadaConTres()
    expect(await handleKeepProject(pool, free, { project_key: B })).toEqual({ ok: true })
    expect((await empujar(free, B)).outcome).toBe('applied')
    expect(await empujar(free, A)).toMatchObject({ outcome: 'rejected', error: 'project_limit_reached' })
  })

  it('un elegido que ya no existe cae al más viejo', async () => {
    const { free, A, B } = await bajadaConTres()
    await pool.query('update users set kept_project_key = $2 where id = $1', [free.userId, `${RUN}-borrado`])
    expect((await empujar(free, A)).outcome).toBe('applied')
    expect(await empujar(free, B)).toMatchObject({ outcome: 'rejected', error: 'project_limit_reached' })
  })

  it('al volver a pagar la regla deja de aplicar y kept_project_key queda guardado', async () => {
    const { free, A, B, C } = await bajadaConTres()
    await handleKeepProject(pool, free, { project_key: C })
    await pool.query(`update users set plan = 'cloud' where id = $1`, [free.userId])
    const cloud = { ...free, plan: 'cloud' }
    for (const k of [A, B, C]) expect((await empujar(cloud, k)).outcome).toBe('applied')
    const { rows } = await pool.query('select kept_project_key from users where id = $1', [free.userId])
    expect(rows[0].kept_project_key).toBe(C)
  })
})

describe('POST /v1/projects/keep', () => {
  it('un proyecto ajeno, inexistente, vacío o __global__ es 400 unknown_project', async () => {
    const { free } = await bajadaConTres()
    const otro = await bajadaConTres()
    for (const project_key of [otro.A, `${RUN}-nada`, '', GLOBAL, 42]) {
      expect(await handleKeepProject(pool, free, { project_key })).toEqual({ ok: false, status: 400, error: 'unknown_project' })
    }
  })

  it('sin estar por encima del tope es 409 not_over_limit', async () => {
    const f = await seed('free')
    const K = `${RUN}-solo-${f.userId.slice(0, 4)}`
    await empujar(f, K)
    expect(await handleKeepProject(pool, f, { project_key: K })).toEqual({ ok: false, status: 409, error: 'not_over_limit' })
  })
})

describe('status — kept_project_key y over_limit', () => {
  it('por encima del tope: over_limit y el elegido; el roster por antigüedad (D2)', async () => {
    const { free, A, B, C } = await bajadaConTres()
    const antes = await handleStatus(pool, free)
    expect(antes.over_limit).toBe(true)
    expect(antes.kept_project_key).toBeNull()
    expect(antes.projects.map((p) => p.project_key).filter((k) => k !== GLOBAL)).toEqual([A, B, C])

    await handleKeepProject(pool, free, { project_key: B })
    expect((await handleStatus(pool, free)).kept_project_key).toBe(B)
  })

  it('un kept_project_key que ya no es propio sale como null (D3)', async () => {
    const { free } = await bajadaConTres()
    await pool.query('update users set kept_project_key = $2 where id = $1', [free.userId, `${RUN}-borrado`])
    expect((await handleStatus(pool, free)).kept_project_key).toBeNull()
  })

  // Review Focus 4: __global__ no ocupa lugar.
  it('un Free con __global__ y su único proyecto NO está over_limit', async () => {
    const f = await seed('free')
    await empujar(f, GLOBAL)
    await empujar(f, `${RUN}-uno-${f.userId.slice(0, 4)}`)
    const s = await handleStatus(pool, f)
    expect(s.over_limit).toBe(false)
    expect(s.kept_project_key).toBeNull()
  })
})
