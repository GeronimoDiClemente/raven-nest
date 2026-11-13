// Task de observabilidad (005_observability.sql): handlePull tiene que incrementar
// devices.pull_count una vez por LLAMADA, sin importar cuántas filas devuelva — la
// mayoría de los pulls en producción vienen vacíos (§11.4), y el contador mide actividad
// de llamadas, no resultados.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePull } from '../src/pull'

const pool = getPool()

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })

async function seedDevice(): Promise<{ deviceId: string; userId: string; plan: string }> {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'obs-pull', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  return { deviceId, userId, plan: 'pro' }
}

async function pullCountFor(deviceId: string): Promise<number> {
  const { rows } = await pool.query(`select pull_count from devices where id = $1`, [deviceId])
  return Number(rows[0].pull_count)
}

describe('handlePull observability: devices.pull_count', () => {
  it('un pull exitoso incrementa pull_count en 1', async () => {
    const device = await seedDevice()
    const p = `obs-pull-${randomUUID().slice(0, 8)}`

    await handlePull(pool, device, { cursors: { [p]: 0 }, limit: 500 })

    expect(await pullCountFor(device.deviceId)).toBe(1)
  })

  it('dos pulls seguidos del mismo device suman a 2', async () => {
    const device = await seedDevice()
    const p = `obs-pull-${randomUUID().slice(0, 8)}`

    await handlePull(pool, device, { cursors: { [p]: 0 }, limit: 500 })
    await handlePull(pool, device, { cursors: { [p]: 0 }, limit: 500 })

    expect(await pullCountFor(device.deviceId)).toBe(2)
  })

  it('un pull vacío (sin cursores, el early-return) también cuenta como actividad', async () => {
    // `cursors: {}` es el early-return de handlePull (línea "keys.length === 0"): el caso
    // más común en producción. El contador mide llamadas, no resultados devueltos.
    const device = await seedDevice()

    await handlePull(pool, device, {})

    expect(await pullCountFor(device.deviceId)).toBe(1)
  })

  it('no mezcla el contador entre devices distintos', async () => {
    const deviceA = await seedDevice()
    const deviceB = await seedDevice()
    const p = `obs-pull-${randomUUID().slice(0, 8)}`

    await handlePull(pool, deviceA, { cursors: { [p]: 0 }, limit: 500 })
    await handlePull(pool, deviceA, { cursors: { [p]: 0 }, limit: 500 })
    await handlePull(pool, deviceB, { cursors: { [p]: 0 }, limit: 500 })

    expect(await pullCountFor(deviceA.deviceId)).toBe(2)
    expect(await pullCountFor(deviceB.deviceId)).toBe(1)
  })
})
