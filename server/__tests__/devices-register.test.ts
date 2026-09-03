// §9.2 — la mitad que toca la base. NECESITA POSTGRES: como el resto de los tests de
// `server/`, corre contra la base real (DATABASE_URL o el default de db.ts).
//
// NO SE PUDO CORRER EN LA MAC donde se escribió: no hay Docker ni un Postgres local.
// Escrito contra el schema de `001_init.sql`, leído línea por línea, pero sin ejecutar.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { hashToken, authenticate } from '../src/auth'
import { registerDevice, generateDeviceToken } from '../src/devices'

const pool = getPool()
let userId: string

beforeAll(async () => {
  await migrate(pool)
  userId = randomUUID()
})

afterAll(async () => { await pool.end() })

describe('generateDeviceToken', () => {
  it('tiene el prefijo nmk_ y no se repite', () => {
    const a = generateDeviceToken()
    expect(a.startsWith('nmk_')).toBe(true)
    expect(a).not.toBe(generateDeviceToken())
  })
})

describe('registerDevice', () => {
  it('rechaza con not_in_beta a alguien que no esta en el allowlist, y no le crea el device', async () => {
    const fuera = randomUUID()

    const r = await registerDevice(pool, { userId: fuera, email: 'fuera@x.com' }, { name: 'Mac' })

    expect(r).toEqual({ ok: false, status: 403, error: 'not_in_beta' })
    const { rows } = await pool.query('select count(*)::int as n from devices where user_id = $1', [fuera])
    expect(rows[0].n).toBe(0)
  })

  it('crea el usuario, el device, y el token que devuelve sirve para autenticar', async () => {
    await pool.query('insert into users (id, plan) values ($1, $2) on conflict do nothing', [userId, 'cloud'])
    await pool.query('insert into allowlist (user_id) values ($1) on conflict do nothing', [userId])

    const r = await registerDevice(pool, { userId, email: 'gero@nestmux.com' }, { name: 'Mac de Gero', platform: 'darwin' })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    // La prueba de que el camino cierra: el token recién emitido pasa `authenticate`.
    await expect(authenticate(pool, `Bearer ${r.token}`)).resolves.toMatchObject({
      ok: true, deviceId: r.deviceId, userId, plan: 'cloud',
    })
  })

  it('guarda el hash, nunca el token', async () => {
    await pool.query('insert into allowlist (user_id) values ($1) on conflict do nothing', [userId])

    const r = await registerDevice(pool, { userId, email: null }, { name: 'Otra' })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { rows } = await pool.query('select token_hash from devices where id = $1', [r.deviceId])
    expect(rows[0].token_hash).toBe(hashToken(r.token))
    expect(rows[0].token_hash).not.toContain(r.token)
  })

  // El plan NO viaja en el JWT de Supabase. Pisarlo con 'free' en cada registro degradaría
  // a un usuario que paga apenas conecta una segunda máquina.
  it('no pisa el plan de un usuario que ya existe', async () => {
    const pago = randomUUID()
    await pool.query(`insert into users (id, plan) values ($1, 'team')`, [pago])
    await pool.query('insert into allowlist (user_id) values ($1)', [pago])

    await registerDevice(pool, { userId: pago, email: 'x@y.com' }, { name: 'Segunda' })

    const { rows } = await pool.query('select plan from users where id = $1', [pago])
    expect(rows[0].plan).toBe('team')
  })

  it('un usuario nuevo entra como free, que es un plan de nube valido (1 proyecto)', async () => {
    const nuevo = randomUUID()
    await pool.query('insert into allowlist (user_id) values ($1)', [nuevo])

    const r = await registerDevice(pool, { userId: nuevo, email: null }, { name: 'Primera' })

    expect(r.ok).toBe(true)
    const { rows } = await pool.query('select plan from users where id = $1', [nuevo])
    expect(rows[0].plan).toBe('free')
  })

  it('registrar dos veces da dos devices distintos con tokens distintos', async () => {
    const dos = randomUUID()
    await pool.query('insert into allowlist (user_id) values ($1)', [dos])

    const a = await registerDevice(pool, { userId: dos, email: null }, { name: 'Mac' })
    const b = await registerDevice(pool, { userId: dos, email: null }, { name: 'PC' })

    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.deviceId).not.toBe(b.deviceId)
    expect(a.token).not.toBe(b.token)
  })
})
