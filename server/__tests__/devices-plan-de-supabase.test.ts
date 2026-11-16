// Spec 2b-2 §4.6: al registrar un device se relee `profiles.plan` con el JWT del usuario.
// Si es pago, se aplica ANTES del chequeo de allowlist. Sólo sube, nunca baja (D4).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { registerDevice } from '../src/devices'

const pool = getPool()
const ENV_ANTES = { ...process.env }
const FETCH_ANTES = global.fetch

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })
afterEach(() => {
  process.env = { ...ENV_ANTES }
  global.fetch = FETCH_ANTES
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Supabase falso que contesta por ruta: `profiles` con lo pedido, `team_members` vacío. */
function mockSupabase(profiles: unknown | Error) {
  process.env.SUPABASE_URL = 'https://ejemplo.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'anon-key-de-prueba'
  const impl = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.includes('/rest/v1/profiles')) {
      if (profiles instanceof Error) throw profiles
      return json(profiles)
    }
    return json([])
  })
  global.fetch = impl as unknown as typeof fetch
  return impl
}

async function estado(userId: string) {
  const { rows: u } = await pool.query('select plan from users where id = $1', [userId])
  const { rows: a } = await pool.query('select 1 from allowlist where user_id = $1', [userId])
  return { plan: (u[0]?.plan as string | undefined) ?? null, enAllowlist: a.length > 0 }
}

describe('registerDevice — el plan de Supabase como red de seguridad', () => {
  it('un plan pago leído se aplica y destraba not_in_beta', async () => {
    const userId = randomUUID()
    const impl = mockSupabase([{ plan: 'cloud' }])

    const r = await registerDevice(pool, { userId, email: null }, { name: 'Mac' }, 'jwt-de-prueba')

    expect(r.ok).toBe(true)
    expect(await estado(userId)).toEqual({ plan: 'cloud', enAllowlist: true })
    const llamada = impl.mock.calls.find(([url]) => String(url).includes('/rest/v1/profiles'))!
    expect(String(llamada[0])).toContain(`id=eq.${userId}`)
    expect(String(llamada[0])).toContain('select=plan')
    const headers = (llamada[1] as { headers: Record<string, string> }).headers
    expect(headers.Authorization).toBe('Bearer jwt-de-prueba')
    expect(headers.apikey).toBe('anon-key-de-prueba')
  })

  it('un free leído NO baja un users.plan pago puesto a mano', async () => {
    const userId = randomUUID()
    await pool.query(`insert into users (id, plan) values ($1, 'team')`, [userId])
    await pool.query('insert into allowlist (user_id) values ($1)', [userId])
    mockSupabase([{ plan: 'free' }])

    const r = await registerDevice(pool, { userId, email: null }, { name: 'Mac' }, 'jwt-de-prueba')

    expect(r.ok).toBe(true)
    expect(await estado(userId)).toEqual({ plan: 'team', enAllowlist: true })
  })

  it('un pago leído no pisa otro pago (D4: sólo sube desde un plan no pago)', async () => {
    const userId = randomUUID()
    await pool.query(`insert into users (id, plan) values ($1, 'enterprise')`, [userId])
    await pool.query('insert into allowlist (user_id) values ($1)', [userId])
    mockSupabase([{ plan: 'cloud' }])

    await registerDevice(pool, { userId, email: null }, { name: 'Mac' }, 'jwt-de-prueba')

    expect(await estado(userId)).toEqual({ plan: 'enterprise', enAllowlist: true })
  })

  it('el fetch que falla no rompe el registro: todo sigue como hoy', async () => {
    const permitido = randomUUID()
    await pool.query('insert into users (id) values ($1)', [permitido])
    await pool.query('insert into allowlist (user_id) values ($1)', [permitido])
    mockSupabase(new Error('ECONNREFUSED'))
    expect((await registerDevice(pool, { userId: permitido, email: null }, { name: 'Mac' }, 'jwt')).ok).toBe(true)

    const fuera = randomUUID()
    expect(await registerDevice(pool, { userId: fuera, email: null }, { name: 'Mac' }, 'jwt'))
      .toEqual({ ok: false, status: 403, error: 'not_in_beta' })
  })

  it('sin perfil, plan desconocido o respuesta rara: no hace nada', async () => {
    for (const respuesta of [[], [{ plan: 'diamante' }], [{}], { plan: 'cloud' }]) {
      const fuera = randomUUID()
      mockSupabase(respuesta)
      expect(await registerDevice(pool, { userId: fuera, email: null }, { name: 'Mac' }, 'jwt'))
        .toEqual({ ok: false, status: 403, error: 'not_in_beta' })
      // `not_in_beta` hace rollback: ni el usuario queda creado.
      expect(await estado(fuera)).toEqual({ plan: null, enAllowlist: false })
    }
  })

  it('sin JWT (vinculación por código) no consulta Supabase', async () => {
    const impl = mockSupabase([{ plan: 'cloud' }])
    const fuera = randomUUID()
    await registerDevice(pool, { userId: fuera, email: null }, { name: 'Mac' })
    expect(impl).not.toHaveBeenCalled()
  })
})
