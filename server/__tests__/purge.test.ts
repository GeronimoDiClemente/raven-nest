import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { purgeTombstones } from '../src/purge'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)

let userId: string
let projectId: number

beforeAll(async () => {
  await migrate(pool)
  userId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  const { rows } = await pool.query(
    `insert into projects (user_id, project_key, display_name) values ($1, $2, $2) returning id`,
    [userId, `purge-${RUN}`]
  )
  projectId = Number(rows[0].id)
})
afterAll(async () => { await pool.end() })

async function insertObservation(label: string, deleted: boolean, ageDays: number) {
  const syncId = `${RUN}-${label}`
  await pool.query(
    `insert into observations
       (sync_id, project_id, project_seq, scope, type, title, content, author_id,
        lamport, client_updated_at, client_created_at, server_created_at, deleted)
     values ($1, $2, $3, 'personal', 'decision', 't', 'c', $4, 1, now(), now(),
             now() - ($5 || ' days')::interval, $6)`,
    [syncId, projectId, Math.floor(Math.random() * 1e9), userId, String(ageDays), deleted]
  )
  return syncId
}

describe('purgeTombstones', () => {
  it('borra los tombstones mas viejos que la ventana', async () => {
    const viejo = await insertObservation('viejo', true, 120)
    const borradas = await purgeTombstones(pool, 90)
    expect(borradas).toBeGreaterThanOrEqual(1)

    const { rows } = await pool.query('select 1 from observations where sync_id = $1', [viejo])
    expect(rows).toHaveLength(0)
  })

  it('no toca un tombstone dentro de la ventana', async () => {
    const reciente = await insertObservation('reciente', true, 10)
    await purgeTombstones(pool, 90)
    const { rows } = await pool.query('select 1 from observations where sync_id = $1', [reciente])
    expect(rows).toHaveLength(1)
  })

  // Lo unico que importa de verdad: la purga no puede tocar memoria VIVA por vieja que sea.
  it('nunca borra una observacion viva, por mas antigua que sea', async () => {
    const viva = await insertObservation('viva', false, 5000)
    await purgeTombstones(pool, 90)
    const { rows } = await pool.query('select 1 from observations where sync_id = $1', [viva])
    expect(rows).toHaveLength(1)
  })
})
