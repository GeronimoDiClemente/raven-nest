import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

// 005_observability.sql: `devices.push_count`/`pull_count` (contador por LLAMADA al
// handler) y la tabla `rejected_pushes` (log de rechazos terminales). Este archivo cubre
// SOLO esa observabilidad -- la logica de push en si ya tiene su propia suite.
const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = (label: string) => `observability-${RUN}-${label}`

const userIds: string[] = []

async function seedAccount(label: string, plan = 'pro') {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, $2)`, [userId, plan])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)`,
    [deviceId, userId, label, `hash-${deviceId}`]
  )
  userIds.push(userId)
  return { deviceId, userId, plan }
}

beforeAll(async () => {
  await migrate(pool)
})

// devices/projects/push_receipts/rejected_pushes cuelgan de `users` con `on delete
// cascade`, pero `observations.author_id` NO tiene cascade (es un FK de auditoria, no de
// pertenencia) -- hay que borrar las observaciones a mano ANTES de borrar los usuarios, o el
// delete de `users` rebota con una violacion de FK.
afterAll(async () => {
  if (userIds.length > 0) {
    await pool.query(`delete from observations where author_id = any($1::uuid[])`, [userIds])
    await pool.query(`delete from users where id = any($1::uuid[])`, [userIds])
  }
  await pool.end()
})

function mutation(
  seq: number,
  syncId: string,
  projectKey: string,
  extra: Record<string, unknown> = {}
) {
  return {
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
      ...extra,
    },
  }
}

async function pushCountOf(deviceId: string): Promise<number> {
  const { rows } = await pool.query('select push_count from devices where id = $1', [deviceId])
  return Number(rows[0].push_count)
}

/**
 * Igual que en push-classify.test.ts: envuelve el pool real para que UNA consulta falle con
 * un error elegido, y todo lo demas corra contra la base real. Sirve para forzar el camino
 * TRANSIENTE (uno que classifyPushError no puede provocar desde un payload, porque eso es
 * justo lo que lo hace transiente).
 */
function poolFailingOn(match: string, targetSyncId: string, err: Error): Pool {
  return {
    connect: async () => {
      const client: PoolClient = await pool.connect()
      return new Proxy(client, {
        get(target, prop, receiver) {
          if (prop === 'query') {
            return (text: unknown, params?: unknown[]) => {
              if (typeof text === 'string' && text.includes(match) && params?.[0] === targetSyncId) {
                return Promise.reject(err)
              }
              return (target.query as (t: unknown, p?: unknown[]) => Promise<unknown>)(text, params)
            }
          }
          const value = Reflect.get(target, prop, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
  } as unknown as Pool
}

describe('push observability (005_observability.sql)', () => {
  it('a) un push exitoso incrementa devices.push_count en 1', async () => {
    const dev = await seedAccount('count-1')
    expect(await pushCountOf(dev.deviceId)).toBe(0)

    const res = await handlePush(pool, dev, {
      mutations: [mutation(1, SYNC('ok-1'), PROJECT('count-1'))],
    })
    expect(res.results[0].outcome).toBe('applied')
    expect(await pushCountOf(dev.deviceId)).toBe(1)
  })

  it('b) dos pushes seguidos del mismo device lo llevan a 2 (no se resetea, no se duplica)', async () => {
    const dev = await seedAccount('count-2')
    const p = PROJECT('count-2')

    await handlePush(pool, dev, { mutations: [mutation(1, SYNC('ok-2a'), p)] })
    expect(await pushCountOf(dev.deviceId)).toBe(1)

    await handlePush(pool, dev, { mutations: [mutation(2, SYNC('ok-2b'), p)] })
    expect(await pushCountOf(dev.deviceId)).toBe(2)
  })

  it('c) un rechazo terminal deja fila en rejected_pushes Y ADEMAS incrementa push_count', async () => {
    // Mismo mecanismo que push-tenancy.test.ts: sync_id es una PK global sin salt por
    // usuario, asi que dos cuentas distintas pisando el mismo sync_id chocan con el
    // `where observations.author_id = excluded.author_id` del ON CONFLICT -> el upsert no
    // actualiza ninguna fila -> TerminalPushError('sync_id_conflict'). Rechazo terminal
    // REAL, no un mock.
    const owner = await seedAccount('reject-owner')
    const intruder = await seedAccount('reject-intruder')
    const shared = SYNC('conflict')

    const mine = await handlePush(pool, owner, {
      mutations: [mutation(1, shared, PROJECT('reject-owner'), { content: 'de owner' })],
    })
    expect(mine.results[0].outcome).toBe('applied')

    expect(await pushCountOf(intruder.deviceId)).toBe(0)
    const theirs = await handlePush(pool, intruder, {
      mutations: [mutation(1, shared, PROJECT('reject-intruder'), { content: 'de intruder' })],
    })
    expect(theirs.results[0]).toMatchObject({
      sync_id: shared,
      outcome: 'rejected',
      error: 'sync_id_conflict',
    })

    // El contador es por LLAMADA, no depende de si la mutacion individual fue rechazada.
    expect(await pushCountOf(intruder.deviceId)).toBe(1)

    const { rows } = await pool.query(
      `select device_id, sync_id, error from rejected_pushes where device_id = $1 and sync_id = $2`,
      [intruder.deviceId, shared]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].device_id).toBe(intruder.deviceId)
    expect(rows[0].sync_id).toBe(shared)
    expect(rows[0].error).toBe('sync_id_conflict')
  })

  it('d) EL MAS IMPORTANTE: rejected_pushes sobrevive el rollback que se lleva el claim de push_receipts', async () => {
    // Misma mecanica que (c), mirada desde la asimetria que prueba que el insert de
    // rejected_pushes NO depende del commit de la transaccion de la mutacion:
    // push_receipts SI depende de ese commit (comportamiento preexistente, no se toca) y por
    // eso no deja fila para el (device_id, seq) rechazado; rejected_pushes vive en un INSERT
    // aparte, escrito DESPUES del rollback, y por eso si la deja. Si alguien moviera ese
    // insert adentro de la transaccion que hace rollback, las dos filas desaparecerian y
    // este test lo detectaria.
    const owner = await seedAccount('asym-owner')
    const intruder = await seedAccount('asym-intruder')
    const shared = SYNC('asymmetry')
    const seq = 42

    await handlePush(pool, owner, {
      mutations: [mutation(seq, shared, PROJECT('asym-owner'))],
    })
    const theirs = await handlePush(pool, intruder, {
      mutations: [mutation(seq, shared, PROJECT('asym-intruder'))],
    })
    expect(theirs.results[0].outcome).toBe('rejected')

    const receipt = await pool.query(
      'select count(*)::int as n from push_receipts where device_id = $1 and seq = $2',
      [intruder.deviceId, seq]
    )
    expect(receipt.rows[0].n).toBe(0) // se pierde en el rollback (comportamiento preexistente)

    const rejected = await pool.query(
      'select count(*)::int as n from rejected_pushes where device_id = $1 and sync_id = $2',
      [intruder.deviceId, shared]
    )
    expect(rejected.rows[0].n).toBe(1) // sobrevive el mismo rollback
  })

  it('e) un rechazo TRANSIENTE no deja fila en rejected_pushes', async () => {
    const dev = await seedAccount('transient')
    const p = PROJECT('transient')
    const syncId = SYNC('transient-1')
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' })
    const flaky = poolFailingOn('insert into observations', syncId, deadlock)

    const res = await handlePush(flaky, dev, {
      mutations: [mutation(1, syncId, p)],
    })
    expect(res.results.some((r) => r.sync_id === syncId)).toBe(false) // omitido, no rechazado
    expect(await pushCountOf(dev.deviceId)).toBe(1) // el contador de llamada igual sube

    const rejected = await pool.query(
      'select count(*)::int as n from rejected_pushes where device_id = $1 and sync_id = $2',
      [dev.deviceId, syncId]
    )
    expect(rejected.rows[0].n).toBe(0)
  })
})
