// Team Memory Layer 1, Parte 2 — sincronización de `team_memberships` en `registerDevice()`.
// Mismo patrón que `devices-register.test.ts`: corre contra Postgres real (DATABASE_URL o el
// default de `db.ts`). El fetch a Supabase se mockea acá — ningún test de este archivo le
// pega a Supabase real.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { registerDevice } from '../src/devices'

const pool = getPool()

const ENV_ANTES = { ...process.env }
const FETCH_ANTES = global.fetch

beforeAll(async () => {
  await migrate(pool)
})

afterAll(async () => {
  await pool.end()
})

// Cada test setea su propia config de Supabase (o la borra) y su propio fetch falso. Sin
// este afterEach, un test que configura SUPABASE_URL contaminaría al siguiente.
afterEach(() => {
  process.env = { ...ENV_ANTES }
  global.fetch = FETCH_ANTES
})

async function seedUsuarioPermitido(): Promise<string> {
  const userId = randomUUID()
  await pool.query('insert into users (id) values ($1)', [userId])
  await pool.query('insert into allowlist (user_id) values ($1)', [userId])
  return userId
}

function mockSupabaseJson(body: unknown, status = 200) {
  const impl = vi.fn(async (_url: string, _init: RequestInit & { headers: Record<string, string> }) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  )
  global.fetch = impl as unknown as typeof fetch
  return impl
}

function mockSupabaseFailure(err: Error) {
  const impl = vi.fn(async () => { throw err })
  global.fetch = impl as unknown as typeof fetch
  return impl
}

async function membresiasDe(userId: string) {
  const { rows } = await pool.query(
    `select team_id, team_name, role, status from team_memberships
      where user_id = $1 order by team_id`,
    [userId]
  )
  return rows
}

describe('registerDevice — sincronización de team_memberships', () => {
  it('(a) con membresías reales en la respuesta mockeada, las inserta en team_memberships', async () => {
    const userId = await seedUsuarioPermitido()
    process.env.SUPABASE_URL = 'https://qkqlsytxtshgjxwmafpw.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-key-de-prueba'
    const fetchImpl = mockSupabaseJson([
      { team_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', role: 'owner', teams: { name: 'Equipo Uno' } },
      { team_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', role: 'member', teams: { name: 'Equipo Dos' } },
    ])

    const r = await registerDevice(pool, { userId, email: null }, { name: 'Mac' }, 'jwt-de-prueba')

    expect(r.ok).toBe(true)
    expect(await membresiasDe(userId)).toEqual([
      { team_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', team_name: 'Equipo Uno', role: 'owner', status: 'active' },
      { team_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', team_name: 'Equipo Dos', role: 'member', status: 'active' },
    ])

    // El request usa el JWT del login como bearer — nunca una service-role key — y trae la
    // apikey. Es el contrato central del diseño: la consulta respeta la RLS del usuario.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain('https://qkqlsytxtshgjxwmafpw.supabase.co/rest/v1/team_members')
    expect(url).toContain(`user_id=eq.${userId}`)
    expect(url).toContain('status=eq.active')
    expect(init.headers.Authorization).toBe('Bearer jwt-de-prueba')
    expect(init.headers.apikey).toBe('anon-key-de-prueba')
  })

  it('(b) un segundo registro con una membresía menos hace un replace-set real, no un insert incremental', async () => {
    const userId = await seedUsuarioPermitido()
    process.env.SUPABASE_URL = 'https://qkqlsytxtshgjxwmafpw.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-key-de-prueba'

    mockSupabaseJson([
      { team_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', role: 'owner', teams: { name: 'Equipo Uno' } },
      { team_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', role: 'member', teams: { name: 'Equipo Dos' } },
    ])
    await registerDevice(pool, { userId, email: null }, { name: 'Mac' }, 'jwt-1')
    expect(await membresiasDe(userId)).toHaveLength(2)

    mockSupabaseJson([
      { team_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', role: 'owner', teams: { name: 'Equipo Uno' } },
    ])
    const r = await registerDevice(pool, { userId, email: null }, { name: 'PC' }, 'jwt-2')

    expect(r.ok).toBe(true)
    // La que ya no vino en la segunda respuesta desaparece — no queda pegada de la primera.
    expect(await membresiasDe(userId)).toEqual([
      { team_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', team_name: 'Equipo Uno', role: 'owner', status: 'active' },
    ])
  })

  it('(c) sin SUPABASE_URL configurada, el registro de device funciona igual que antes y team_memberships queda vacío', async () => {
    const userId = await seedUsuarioPermitido()
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_ANON_KEY
    const fetchImpl = vi.fn()
    global.fetch = fetchImpl as unknown as typeof fetch

    const r = await registerDevice(pool, { userId, email: null }, { name: 'Mac' }, 'jwt-de-prueba')

    expect(r.ok).toBe(true)
    if (r.ok) {
      // El resto del contrato de siempre, intacto: token, device_id, y que el token sirva.
      expect(typeof r.token).toBe('string')
      expect(typeof r.deviceId).toBe('string')
    }
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await membresiasDe(userId)).toEqual([])
  })

  it('(d) un fallo de red en el fetch no tumba el registro del device, sólo lo deja sin sincronizar', async () => {
    const userId = await seedUsuarioPermitido()
    process.env.SUPABASE_URL = 'https://qkqlsytxtshgjxwmafpw.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-key-de-prueba'
    mockSupabaseFailure(new Error('network error simulado'))

    const r = await registerDevice(pool, { userId, email: null }, { name: 'Mac' }, 'jwt-de-prueba')

    expect(r.ok).toBe(true)
    expect(await membresiasDe(userId)).toEqual([])
  })

  it('(d) un 500 de Supabase tampoco tumba el registro del device', async () => {
    const userId = await seedUsuarioPermitido()
    process.env.SUPABASE_URL = 'https://qkqlsytxtshgjxwmafpw.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-key-de-prueba'
    mockSupabaseJson({ message: 'internal error' }, 500)

    const r = await registerDevice(pool, { userId, email: null }, { name: 'Mac' }, 'jwt-de-prueba')

    expect(r.ok).toBe(true)
    expect(await membresiasDe(userId)).toEqual([])
  })

  // Un fallo de sync NO puede dejar rastro corrupto: si el replace transaccional fallara a
  // mitad de camino, `team_memberships` tiene que quedar como estaba, nunca a medio borrar.
  it('un registro previo con membresías sigue intacto si el próximo registro falla al sincronizar', async () => {
    const userId = await seedUsuarioPermitido()
    process.env.SUPABASE_URL = 'https://qkqlsytxtshgjxwmafpw.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-key-de-prueba'

    mockSupabaseJson([
      { team_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', role: 'owner', teams: { name: 'Equipo Uno' } },
    ])
    await registerDevice(pool, { userId, email: null }, { name: 'Mac' }, 'jwt-1')
    expect(await membresiasDe(userId)).toHaveLength(1)

    mockSupabaseFailure(new Error('network error simulado'))
    const r = await registerDevice(pool, { userId, email: null }, { name: 'PC' }, 'jwt-2')

    expect(r.ok).toBe(true)
    expect(await membresiasDe(userId)).toEqual([
      { team_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', team_name: 'Equipo Uno', role: 'owner', status: 'active' },
    ])
  })
})
