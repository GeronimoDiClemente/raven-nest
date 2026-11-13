// Los recibos y rechazos de push viejos se purgan; los recientes y todo lo demás, no.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { purgeRegistrosDePush } from '../src/purge'

const pool = getPool()
let deviceId: string

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(`insert into devices (id, user_id, name, token_hash) values ($1, $2, 'purga', $3)`, [deviceId, userId, `hash-${deviceId}`])
})
afterAll(async () => { await pool.end() })

const recibo = (seq: number, diasAtras: number) =>
  pool.query(
    `insert into push_receipts (device_id, seq, sync_id, outcome, created_at)
     values ($1, $2, $3, 'applied', now() - ($4 || ' days')::interval)`,
    [deviceId, seq, `s-${seq}`, String(diasAtras)]
  )
const rechazo = (id: string, diasAtras: number) =>
  pool.query(
    `insert into rejected_pushes (device_id, sync_id, error, created_at) values ($1, $2, 'x', now() - ($3 || ' days')::interval)`,
    [deviceId, id, String(diasAtras)]
  )

describe('purgeRegistrosDePush', () => {
  it('borra lo de más de 90 días y deja lo reciente', async () => {
    await recibo(1, 120); await recibo(2, 91); await recibo(3, 10)
    await rechazo('viejo', 200); await rechazo('nuevo', 1)
    await purgeRegistrosDePush(pool)
    const { rows: r } = await pool.query('select seq from push_receipts where device_id = $1 order by seq', [deviceId])
    expect(r.map((x) => Number(x.seq))).toEqual([3])
    const { rows: x } = await pool.query('select sync_id from rejected_pushes where device_id = $1', [deviceId])
    expect(x.map((y) => y.sync_id)).toEqual(['nuevo'])
  })
})

describe('migración 016', () => {
  it('obs_pull ya no existe y el índice de la restricción unique sigue sirviendo el pull', async () => {
    const { rows } = await pool.query(`select indexname, indexdef from pg_indexes where tablename = 'observations'`)
    const nombres = rows.map((r) => r.indexname)
    expect(nombres).not.toContain('obs_pull')
    expect(rows.some((r) => /UNIQUE INDEX .* \(project_id, project_seq\)/.test(r.indexdef))).toBe(true)
  })
})
