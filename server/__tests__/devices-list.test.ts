// Spec 2b-3: Settings › Account lista las máquinas de la cuenta. NECESITA POSTGRES.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { registerDevice, listDevices } from '../src/devices'

const pool = getPool()

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })

async function cuenta() {
  const userId = randomUUID()
  await pool.query('insert into users (id, plan) values ($1, $2)', [userId, 'cloud'])
  await pool.query('insert into allowlist (user_id) values ($1)', [userId])
  return userId
}

async function device(userId: string, name: string, platform?: string) {
  const r = await registerDevice(pool, { userId, email: null }, { name, platform })
  if (!r.ok) throw new Error('el registro falló, el test no puede seguir')
  return r
}

describe('listDevices', () => {
  it('lista las vivas de la cuenta, marca la actual y ordena por last_seen_at desc nulls last', async () => {
    const userId = await cuenta()
    const a = await device(userId, 'Mac', 'darwin')
    const b = await device(userId, 'PC', 'win32')
    const c = await device(userId, 'Vieja')
    const d = await device(userId, 'Sin visto')
    const ajena = await device(await cuenta(), 'Ajena')
    await pool.query(`update devices set last_seen_at = '2026-01-01T00:00:00Z' where id = $1`, [a.deviceId])
    await pool.query(`update devices set last_seen_at = '2026-02-01T00:00:00Z' where id = $1`, [b.deviceId])
    await pool.query(`update devices set last_seen_at = null where id = $1`, [d.deviceId])
    await pool.query('update devices set revoked_at = now() where id = $1', [c.deviceId])

    const r = await listDevices(pool, `Bearer ${a.token}`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.devices.map((x) => x.id)).toEqual([b.deviceId, a.deviceId, d.deviceId])
    expect(r.devices.map((x) => x.current)).toEqual([false, true, false])
    expect(r.devices[0]).toEqual({
      id: b.deviceId, name: 'PC', platform: 'win32', last_seen_at: '2026-02-01T00:00:00.000Z', current: false,
    })
    expect(r.devices[2].last_seen_at).toBeNull()
    expect(r.devices.some((x) => x.id === ajena.deviceId)).toBe(false)
  })

  it('token inválido, vacío o revocado es 401', async () => {
    const userId = await cuenta()
    const a = await device(userId, 'Mac')
    await pool.query('update devices set revoked_at = now() where id = $1', [a.deviceId])
    const esperado = { ok: false, status: 401, error: 'unauthorized' }
    await expect(listDevices(pool, 'nmk_nunca_existio')).resolves.toEqual(esperado)
    await expect(listDevices(pool, '')).resolves.toEqual(esperado)
    await expect(listDevices(pool, a.token)).resolves.toEqual(esperado)
  })
})
