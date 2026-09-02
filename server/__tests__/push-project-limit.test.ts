import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = (label: string) => `plimit-${RUN}-${label}`
// La particion interna del cliente. A proposito NO lleva el prefijo del run: es la MISMA
// clave literal que manda el cliente real (`GLOBAL_PROJECT_KEY` en
// electron/memory-project-key.ts), y es lo que se esta testeando.
const GLOBAL = '__global__'

let free: { deviceId: string; userId: string; plan: string }

async function seed(plan: string) {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, $2)`, [userId, plan])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'plimit', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  return { deviceId, userId, plan }
}

const mut = (seq: number, syncId: string, projectKey: string) => ({
  seq,
  sync_id: syncId,
  op: 'upsert' as const,
  payload: {
    sync_id: syncId,
    project_key: projectKey,
    project_display_name: projectKey,
    scope: 'personal',
    type: 'decision',
    topic_key: null,
    title: 'a title',
    content: 'a body',
    tags: [],
    lamport: 1,
    updated_at: Date.now(),
    created_at: Date.now(),
  },
})

beforeAll(async () => {
  await migrate(pool)
  free = await seed('free')
})
afterAll(async () => { await pool.end() })

describe('push — tope de proyectos por plan', () => {
  it('deja al primer proyecto de un plan Free y rechaza el segundo', async () => {
    const first = await handlePush(pool, free, {
      mutations: [mut(1, SYNC('p1'), PROJECT('uno'))],
    })
    expect(first.results[0].outcome).toBe('applied')

    const second = await handlePush(pool, free, {
      mutations: [mut(2, SYNC('p2'), PROJECT('dos'))],
    })
    expect(second.results[0]).toMatchObject({
      outcome: 'rejected',
      error: 'project_limit_reached',
    })

    // El proyecto de mas no se crea: la cuenta sigue teniendo uno solo.
    const { rows } = await pool.query('select count(*)::int as n from projects where user_id = $1', [
      free.userId,
    ])
    expect(rows[0].n).toBe(1)
  })

  it('sigue aceptando escrituras en el proyecto que ya esta en la nube', async () => {
    const res = await handlePush(pool, free, {
      mutations: [mut(3, SYNC('p3'), PROJECT('uno'))],
    })
    expect(res.results[0].outcome).toBe('applied')
  })

  it('no le pone el tope de Free a una cuenta Cloud', async () => {
    const cloud = await seed('cloud')
    await handlePush(pool, cloud, { mutations: [mut(1, SYNC('c1'), PROJECT('c-uno'))] })
    const res = await handlePush(pool, cloud, {
      mutations: [mut(2, SYNC('c2'), PROJECT('c-dos'))],
    })
    expect(res.results[0].outcome).toBe('applied')
  })
})

// `__global__` la crea el CLIENTE solo, en cada connect (`ensureProject('__global__')` en
// electron/main.ts) y la usa de fallback para toda captura sin repo resoluble
// (electron/memory-project-key.ts). Si pagara el tope, en un Free el único lugar se lo
// podría llevar ella en vez del repo del usuario — según qué clave apareciera primero en el
// batch más viejo de la cola, que es un log plano ordenado por `seq` sobre TODOS los
// proyectos. O sea: el gancho central del producto librado al azar.
describe('push — `__global__` no compite por el lugar del plan Free', () => {
  it('deja a un Free tener `__global__` Y su repo, los dos aplicando', async () => {
    const acc = await seed('free')
    const res = await handlePush(pool, acc, {
      mutations: [
        mut(1, SYNC('g-glob'), GLOBAL),
        mut(2, SYNC('g-repo'), PROJECT('con-global')),
      ],
    })
    expect(res.results.map((r) => r.outcome)).toEqual(['applied', 'applied'])

    const { rows } = await pool.query('select project_key from projects where user_id = $1', [
      acc.userId,
    ])
    expect(rows.map((r) => r.project_key).sort()).toEqual(
      [GLOBAL, PROJECT('con-global')].sort()
    )
  })

  it('con `__global__` ya presente, el SEGUNDO repo sigue rechazandose', async () => {
    const acc = await seed('free')
    const global1 = await handlePush(pool, acc, { mutations: [mut(1, SYNC('h-glob'), GLOBAL)] })
    expect(global1.results[0].outcome).toBe('applied')

    const repo1 = await handlePush(pool, acc, {
      mutations: [mut(2, SYNC('h-repo1'), PROJECT('h-uno'))],
    })
    expect(repo1.results[0].outcome).toBe('applied')

    const repo2 = await handlePush(pool, acc, {
      mutations: [mut(3, SYNC('h-repo2'), PROJECT('h-dos'))],
    })
    expect(repo2.results[0]).toMatchObject({
      outcome: 'rejected',
      error: 'project_limit_reached',
    })

    // Y el tope alcanzado no le corta la sincronizacion a `__global__`: nunca se rechaza.
    const global2 = await handlePush(pool, acc, { mutations: [mut(4, SYNC('h-glob2'), GLOBAL)] })
    expect(global2.results[0].outcome).toBe('applied')

    const { rows } = await pool.query('select project_key from projects where user_id = $1', [
      acc.userId,
    ])
    expect(rows.map((r) => r.project_key).sort()).toEqual([GLOBAL, PROJECT('h-uno')].sort())
  })
})
