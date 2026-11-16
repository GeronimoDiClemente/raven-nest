// `check`: lo que la página ve antes de aprobar. NECESITA POSTGRES.
//
// El test que importa es el de acuerdo: para cada estado de cuenta, lo que dice `check` es lo
// que de verdad pasaría registrando la máquina y autenticándola. Si alguien cambia una regla
// sólo en `authenticate` o sólo en `registerDevice`, falla acá.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { authenticate, hashToken } from '../src/auth'
import { registerDevice, elegibilidadDeMaquinaNueva } from '../src/devices'
import { veredictoDeElegibilidad } from '../src/elegibilidad'
import {
  iniciarVinculacion, aprobarVinculacion, consultarVinculacion, reclamarVinculacion, VIGENCIA_MS, INTERVALO_MS,
} from '../src/link'

const pool = getPool()
// Sin Supabase de fondo: un SUPABASE_URL heredado de la shell haría que `planPagoDeSupabase`
// salga a la red de verdad. El test que lo necesita lo setea con un fetch falso.
delete process.env.SUPABASE_URL
delete process.env.SUPABASE_ANON_KEY
const ENV_ANTES = { ...process.env }
const FETCH_ANTES = global.fetch

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })
afterEach(() => {
  process.env = { ...ENV_ANTES }
  global.fetch = FETCH_ANTES
})

/** Una cuenta en el estado pedido. Sin `plan`, la cuenta no existe todavía en el servicio. */
async function cuenta(o: { plan?: string; allowlist?: boolean; maquinas?: number }) {
  const userId = randomUUID()
  if (o.plan !== undefined) await pool.query('insert into users (id, plan) values ($1, $2)', [userId, o.plan])
  if (o.allowlist) await pool.query('insert into allowlist (user_id) values ($1)', [userId])
  for (let i = 0; i < (o.maquinas ?? 0); i++) {
    await pool.query('insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)',
      [randomUUID(), userId, `m${i}`, hashToken(randomUUID())])
  }
  return { userId, email: null }
}

/** Lo que de verdad le pasa a una máquina nueva: registrarla y autenticar su token. */
async function loQueHaceRegistrar(identity: { userId: string; email: null }): Promise<string> {
  const alta = await registerDevice(pool, identity, { name: 'nueva' })
  if (!alta.ok) return alta.error
  const auth = await authenticate(pool, `Bearer ${alta.token}`)
  return auth.ok ? 'ok' : auth.error
}

/** Supabase falso: `profiles` dice que la cuenta paga Cloud; `team_members` vacío. */
function supabaseConPlanPago(): void {
  process.env.SUPABASE_URL = 'https://ejemplo.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'anon-key-de-prueba'
  global.fetch = vi.fn(async (url: string) => new Response(
    JSON.stringify(String(url).includes('/rest/v1/profiles') ? [{ plan: 'cloud' }] : []),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )) as unknown as typeof fetch
}

describe('veredictoDeElegibilidad', () => {
  it('beta antes que plan, plan antes que tope', () => {
    expect(veredictoDeElegibilidad({ enAllowlist: false, plan: 'legacy', maquinasPrevias: 99 })).toBe('not_in_beta')
    expect(veredictoDeElegibilidad({ enAllowlist: true, plan: 'legacy', maquinasPrevias: 99 })).toBe('plan_required')
    expect(veredictoDeElegibilidad({ enAllowlist: true, plan: 'free', maquinasPrevias: 3 })).toBe('device_limit_reached')
    expect(veredictoDeElegibilidad({ enAllowlist: true, plan: 'free', maquinasPrevias: 2 })).toBe('ok')
    expect(veredictoDeElegibilidad({ enAllowlist: true, plan: 'cloud', maquinasPrevias: 9 })).toBe('ok')
  })
})

describe('elegibilidadDeMaquinaNueva — el mismo control que registrar + autenticar', () => {
  const CASOS: Array<[string, { plan?: string; allowlist?: boolean; maquinas?: number }, string, string]> = [
    ['cuenta Cloud en la beta', { plan: 'cloud', allowlist: true }, 'ok', 'cloud'],
    ['cuenta que el servicio todavía no conoce', {}, 'not_in_beta', 'free'],
    ['cuenta fuera de la beta', { plan: 'free' }, 'not_in_beta', 'free'],
    ['Free con 2 máquinas', { plan: 'free', allowlist: true, maquinas: 2 }, 'ok', 'free'],
    ['Free con 3 máquinas', { plan: 'free', allowlist: true, maquinas: 3 }, 'device_limit_reached', 'free'],
    ['Cloud con 10 máquinas', { plan: 'cloud', allowlist: true, maquinas: 10 }, 'device_limit_reached', 'cloud'],
    ['un plan sin nube', { plan: 'legacy', allowlist: true }, 'plan_required', 'legacy'],
  ]

  it.each(CASOS)('%s', async (_nombre, estado, esperado, plan) => {
    const identity = await cuenta(estado)
    const dicho = await elegibilidadDeMaquinaNueva(pool, identity)
    expect(dicho).toEqual({ eligibility: esperado, plan })
    expect(await loQueHaceRegistrar(identity)).toBe(dicho.eligibility)
  })

  it('un plan pago en Supabase cuenta como beta, igual que en registerDevice, sin escribir nada', async () => {
    supabaseConPlanPago()
    const identity = await cuenta({})

    expect(await elegibilidadDeMaquinaNueva(pool, identity, 'jwt-de-prueba')).toEqual({ eligibility: 'ok', plan: 'cloud' })
    expect((await pool.query('select 1 from users where id = $1', [identity.userId])).rowCount).toBe(0)
    expect((await pool.query('select 1 from allowlist where user_id = $1', [identity.userId])).rowCount).toBe(0)
  })
})

describe('consultarVinculacion', () => {
  it('devuelve lo que la página muestra, el plan y la elegibilidad', async () => {
    const identity = await cuenta({ plan: 'cloud', allowlist: true })
    const ahora = Date.now()
    const r = await iniciarVinculacion(pool, ahora, { nombre: 'build-box', plataforma: 'linux' })
    const c = await consultarVinculacion(pool, identity, r.codigoDeUsuario, ahora + 60_000)
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(c.pedido).toMatchObject({ deviceName: 'build-box', platform: 'linux', eligibility: 'ok', plan: 'cloud' })
    expect(c.pedido.expiresIn).toBe(Math.floor((VIGENCIA_MS - 60_000) / 1000))
    expect(new Date(c.pedido.expiresAt).getTime() - new Date(c.pedido.createdAt).getTime()).toBe(VIGENCIA_MS)
  })

  it('consultar no crea la cuenta, no emite nada y no aprueba', async () => {
    const identity = await cuenta({})
    const r = await iniciarVinculacion(pool, Date.now())
    const c = await consultarVinculacion(pool, identity, r.codigoDeUsuario, Date.now())
    expect(c).toMatchObject({ ok: true, pedido: { eligibility: 'not_in_beta', plan: 'free' } })
    expect((await pool.query('select 1 from users where id = $1', [identity.userId])).rowCount).toBe(0)
    expect((await pool.query('select 1 from devices where user_id = $1', [identity.userId])).rowCount).toBe(0)
    const { rows } = await pool.query('select user_id from link_requests where user_code = $1', [r.codigoDeUsuario])
    expect(rows[0].user_id).toBeNull()
  })

  it('acepta el código en minúsculas y con espacios (Review Focus 1)', async () => {
    const identity = await cuenta({ plan: 'cloud', allowlist: true })
    const r = await iniciarVinculacion(pool, Date.now())
    const c = await consultarVinculacion(pool, identity, `  ${r.codigoDeUsuario.toLowerCase()} `, Date.now())
    expect(c.ok).toBe(true)
  })

  it('desconocido 404, vencido 400, ya aprobado 409', async () => {
    const identity = await cuenta({ plan: 'cloud', allowlist: true })
    expect(await consultarVinculacion(pool, identity, 'ZZZZ-ZZZZ', Date.now()))
      .toEqual({ ok: false, status: 404, error: 'unknown_code' })

    const ahora = Date.now()
    const viejo = await iniciarVinculacion(pool, ahora)
    expect(await consultarVinculacion(pool, identity, viejo.codigoDeUsuario, ahora + VIGENCIA_MS + 1))
      .toEqual({ ok: false, status: 400, error: 'expired' })

    const aprobado = await iniciarVinculacion(pool, ahora)
    await aprobarVinculacion(pool, identity, aprobado.codigoDeUsuario, ahora + 1000)
    expect(await consultarVinculacion(pool, identity, aprobado.codigoDeUsuario, ahora + 2000))
      .toEqual({ ok: false, status: 409, error: 'already_approved' })
  })
})

describe('check, approve y claim dicen lo mismo con un plan pago que el servicio no conoce (Ruling P1)', () => {
  it('check ok → approve → el claim (sin JWT) emite el token, no not_in_beta', async () => {
    supabaseConPlanPago()
    const identity = await cuenta({})
    const ahora = Date.now()
    const r = await iniciarVinculacion(pool, ahora)

    const c = await consultarVinculacion(pool, identity, r.codigoDeUsuario, ahora, 'jwt-de-prueba')
    expect(c).toMatchObject({ ok: true, pedido: { eligibility: 'ok', plan: 'cloud' } })
    expect(await aprobarVinculacion(pool, identity, r.codigoDeUsuario, ahora + 1000, 'jwt-de-prueba')).toEqual({ ok: true })

    // El claim corre sin JWT: si approve no dejó escrito lo que leyó de Supabase, esto sería
    // `rechazado: not_in_beta`. Supabase se apaga para que no haya duda de quién lo salva.
    delete process.env.SUPABASE_URL
    global.fetch = FETCH_ANTES
    const claim = await reclamarVinculacion(pool, r.codigoDeDispositivo, ahora + 1000 + INTERVALO_MS)
    expect(claim).toMatchObject({ estado: 'vinculado' })
    const { rows } = await pool.query('select plan from users where id = $1', [identity.userId])
    expect(rows[0].plan).toBe('cloud')
  })

  it('approve sin plan pago no escribe nada en users ni en la allowlist', async () => {
    const identity = await cuenta({})
    const ahora = Date.now()
    const r = await iniciarVinculacion(pool, ahora)
    expect(await aprobarVinculacion(pool, identity, r.codigoDeUsuario, ahora, 'jwt-de-prueba')).toEqual({ ok: true })
    expect((await pool.query('select 1 from users where id = $1', [identity.userId])).rowCount).toBe(0)
    expect((await pool.query('select 1 from allowlist where user_id = $1', [identity.userId])).rowCount).toBe(0)
  })
})
