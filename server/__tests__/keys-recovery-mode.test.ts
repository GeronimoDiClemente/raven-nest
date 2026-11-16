// Spec 2026-11-02, "Errores y bordes": regenerar el código de recuperación sin rotar la
// maestra. Sólo toca el slot `recovery` y exige probar la maestra vigente.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { publishWraps } from '../src/keys'

const pool = getPool()
let auth: { userId: string; deviceId: string }

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'cloud')`, [userId])
  await pool.query(`insert into devices (id, user_id, name, token_hash) values ($1, $2, 'd', $3)`, [deviceId, userId, `hash-${deviceId}`])
  auth = { userId, deviceId }
  const r = await publishWraps(pool, auth, {
    key_epoch: 1, mode: 'activate', rotate_verifier: 'verif-1',
    wraps: [
      { slot: deviceId, kind: 'device', wrapped: 'dev-wrap' },
      { slot: 'recovery', kind: 'recovery', wrapped: 'rec-viejo', wrap_meta: { salt: 's1' } },
    ],
  })
  expect(r.ok).toBe(true)
})
afterAll(async () => { await pool.end() })

const nuevo = { slot: 'recovery', kind: 'recovery' as const, wrapped: 'rec-nuevo', wrap_meta: { salt: 's2' } }
async function slots() {
  const { rows } = await pool.query('select slot, wrapped from key_wraps where user_id = $1 order by slot', [auth.userId])
  return Object.fromEntries(rows.map((r) => [r.slot, r.wrapped]))
}

describe('publishWraps — modo recovery', () => {
  it('sin la prueba de la maestra: 403 y nada cambia', async () => {
    const r = await publishWraps(pool, auth, { key_epoch: 1, mode: 'recovery', rotate_proof: 'otra', wraps: [nuevo] })
    expect(r).toMatchObject({ ok: false, status: 403, error: 'must_hold_master' })
    expect((await slots()).recovery).toBe('rec-viejo')
  })

  it('con otra época: 409', async () => {
    const r = await publishWraps(pool, auth, { key_epoch: 2, mode: 'recovery', rotate_proof: 'verif-1', wraps: [nuevo] })
    expect(r).toMatchObject({ ok: false, status: 409, error: 'stale_key_epoch' })
  })

  it('un wrap que no es el de recuperación: 400', async () => {
    const r = await publishWraps(pool, auth, {
      key_epoch: 1, mode: 'recovery', rotate_proof: 'verif-1',
      wraps: [{ slot: auth.deviceId, kind: 'device', wrapped: 'x' }],
    })
    expect(r).toMatchObject({ ok: false, status: 400, error: 'invalid_recovery_wrap' })
  })

  it('con la prueba: reemplaza SÓLO el slot recovery, sin rotar', async () => {
    const r = await publishWraps(pool, auth, { key_epoch: 1, mode: 'recovery', rotate_proof: 'verif-1', wraps: [nuevo] })
    expect(r).toEqual({ ok: true, keyEpoch: 1 })
    expect(await slots()).toEqual({ [auth.deviceId]: 'dev-wrap', recovery: 'rec-nuevo' })
    const { rows } = await pool.query('select key_epoch from users where id = $1', [auth.userId])
    expect(Number(rows[0].key_epoch)).toBe(1)
  })

  it('una cuenta sin cifrado: 409 not_activated', async () => {
    const otro = { userId: randomUUID(), deviceId: randomUUID() }
    await pool.query(`insert into users (id, plan) values ($1, 'cloud')`, [otro.userId])
    const r = await publishWraps(pool, otro, { key_epoch: 1, mode: 'recovery', rotate_proof: 'x', wraps: [nuevo] })
    expect(r).toMatchObject({ ok: false, status: 409, error: 'not_activated' })
  })
})
