// El gemelo de §9.2: cerrar la credencial. NECESITA POSTGRES, como el resto de server/.
//
// NO SE PUDO CORRER EN LA MAC donde se escribió (sin Docker ni Postgres). Typechequea y
// está escrito contra `001_init.sql`, pero nunca se ejecutó.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { authenticate } from '../src/auth'
import { registerDevice, revokeDevices } from '../src/devices'

const pool = getPool()

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })

async function cuentaConDevice(plan = 'cloud') {
  const userId = randomUUID()
  await pool.query('insert into users (id, plan) values ($1, $2)', [userId, plan])
  await pool.query('insert into allowlist (user_id) values ($1)', [userId])
  const r = await registerDevice(pool, { userId, email: null }, { name: 'Mac' })
  if (!r.ok) throw new Error('el registro falló, el test no puede seguir')
  return { userId, deviceId: r.deviceId, token: r.token }
}

describe('revokeDevices', () => {
  it('el token deja de autenticar despues de revocarlo', async () => {
    const cuenta = await cuentaConDevice()
    await expect(authenticate(pool, `Bearer ${cuenta.token}`)).resolves.toMatchObject({ ok: true })

    await expect(revokeDevices(pool, cuenta.token)).resolves.toEqual({ ok: true, revoked: 1 })

    await expect(authenticate(pool, `Bearer ${cuenta.token}`)).resolves.toEqual({
      ok: false, status: 401, error: 'unauthorized',
    })
  })

  it('acepta el header con el prefijo Bearer, igual que authenticate', async () => {
    const cuenta = await cuentaConDevice()
    await expect(revokeDevices(pool, `Bearer ${cuenta.token}`)).resolves.toEqual({ ok: true, revoked: 1 })
  })

  it('por default revoca SOLO la maquina que llama, no las otras del usuario', async () => {
    const cuenta = await cuentaConDevice()
    const otra = await registerDevice(pool, { userId: cuenta.userId, email: null }, { name: 'PC' })
    expect(otra.ok).toBe(true)
    if (!otra.ok) return

    await revokeDevices(pool, cuenta.token)

    await expect(authenticate(pool, `Bearer ${otra.token}`)).resolves.toMatchObject({ ok: true })
  })

  it('con all revoca todas las maquinas del usuario y ninguna de otro', async () => {
    const cuenta = await cuentaConDevice()
    const otra = await registerDevice(pool, { userId: cuenta.userId, email: null }, { name: 'PC' })
    const ajena = await cuentaConDevice()
    if (!otra.ok) throw new Error('registro fallido')

    await expect(revokeDevices(pool, cuenta.token, { all: true })).resolves.toEqual({ ok: true, revoked: 2 })

    await expect(authenticate(pool, `Bearer ${otra.token}`)).resolves.toMatchObject({ ok: false, status: 401 })
    await expect(authenticate(pool, `Bearer ${ajena.token}`)).resolves.toMatchObject({ ok: true })
  })

  // El motivo por el que esto NO pasa por `authenticate`: poder cerrar una credencial no
  // puede depender de seguir siendo cliente. Es la misma razón por la que la UI ofrece
  // Disconnect desde `plan_required`.
  it('revoca igual a alguien fuera del allowlist o sin plan de nube', async () => {
    const cuenta = await cuentaConDevice()
    await pool.query('delete from allowlist where user_id = $1', [cuenta.userId])
    await pool.query(`update users set plan = 'ninguno' where id = $1`, [cuenta.userId])
    await expect(authenticate(pool, `Bearer ${cuenta.token}`)).resolves.toMatchObject({ ok: false, status: 403 })

    await expect(revokeDevices(pool, cuenta.token)).resolves.toEqual({ ok: true, revoked: 1 })
  })

  it('un token ya revocado responde igual que uno inventado: 401, sin decir si existio', async () => {
    const cuenta = await cuentaConDevice()
    await revokeDevices(pool, cuenta.token)

    await expect(revokeDevices(pool, cuenta.token)).resolves.toEqual({ ok: false, status: 401, error: 'unauthorized' })
    await expect(revokeDevices(pool, 'nmk_nunca_existio')).resolves.toEqual({ ok: false, status: 401, error: 'unauthorized' })
  })

  it('un header vacio es 401 y no toca la base', async () => {
    await expect(revokeDevices(pool, '')).resolves.toEqual({ ok: false, status: 401, error: 'unauthorized' })
  })
})
