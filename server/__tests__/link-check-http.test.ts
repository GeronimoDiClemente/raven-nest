// `POST /v1/link/check` de punta a punta. NECESITA POSTGRES.
//
// El limitador de `check` es por cuenta (el `sub` del JWT ya verificado), no por IP: cada test
// que quiera gastar el balde usa una cuenta propia. Los pedidos se crean con
// `iniciarVinculacion` directo, así este archivo no gasta el limitador de `start` (ése sí por IP).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { randomUUID, createHmac } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { getPool, migrate } from '../src/db'
import { createApp } from '../src/http'
import { iniciarVinculacion, VIGENCIA_MS } from '../src/link'

const pool = getPool()
const SECRET = 'secreto-de-prueba'
const FETCH_ANTES = global.fetch
let base: string
let server: ReturnType<typeof createApp>
let userId: string

function jwtDe(sub: string, role = 'authenticated'): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub, email: 'gero@nestmux.com', role, exp: Math.floor(Date.now() / 1000) + 3600 })
  const firma = createHmac('sha256', SECRET).update(`${head}.${payload}`).digest('base64url')
  return `${head}.${payload}.${firma}`
}

beforeAll(async () => {
  process.env.SUPABASE_JWT_SECRET = SECRET
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_ANON_KEY
  await migrate(pool)
  userId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'cloud')`, [userId])
  await pool.query('insert into allowlist (user_id) values ($1)', [userId])
  server = createApp(pool)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(() => {
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_ANON_KEY
  global.fetch = FETCH_ANTES
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  await pool.end()
})

const post = (path: string, body: unknown, jwt?: string) =>
  FETCH_ANTES(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  })
const check = (body: unknown, jwt?: string) => post('/v1/link/check', body, jwt)

describe('POST /v1/link/check', () => {
  it('sin JWT es 401 y no dice nada del pedido', async () => {
    const r = await iniciarVinculacion(pool, Date.now(), { nombre: 'secreta', plataforma: 'linux' })
    const res = await check({ user_code: r.codigoDeUsuario })
    expect(res.status).toBe(401)
    expect(JSON.stringify(await res.json())).not.toContain('secreta')
  })

  it('la anon key no alcanza', async () => {
    const r = await iniciarVinculacion(pool, Date.now())
    expect((await check({ user_code: r.codigoDeUsuario }, jwtDe(userId, 'anon'))).status).toBe(401)
  })

  it('con JWT devuelve la forma del contrato', async () => {
    const r = await iniciarVinculacion(pool, Date.now(), { nombre: 'build-box', plataforma: 'darwin' })
    const res = await check({ user_code: r.codigoDeUsuario }, jwtDe(userId))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j).toMatchObject({ device_name: 'build-box', platform: 'darwin', eligibility: 'ok', plan: 'cloud' })
    expect(typeof j.created_at).toBe('string')
    expect(typeof j.expires_at).toBe('string')
    expect(j.expires_in).toBeGreaterThan(0)
    expect(j.expires_in).toBeLessThanOrEqual(VIGENCIA_MS / 1000)
  })

  it('también acepta `code` en vez de `user_code`', async () => {
    const r = await iniciarVinculacion(pool, Date.now())
    expect((await check({ code: r.codigoDeUsuario }, jwtDe(userId))).status).toBe(200)
  })

  it('sin código es 400 missing_user_code', async () => {
    const res = await check({}, jwtDe(userId))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('missing_user_code')
  })

  it('desconocido 404 y vencido 400, con el error en el cuerpo', async () => {
    const res404 = await check({ user_code: 'ZZZZ-ZZZZ' }, jwtDe(userId))
    expect(res404.status).toBe(404)
    expect((await res404.json()).error).toBe('unknown_code')

    const viejo = await iniciarVinculacion(pool, Date.now() - VIGENCIA_MS - 1000)
    const res400 = await check({ user_code: viejo.codigoDeUsuario }, jwtDe(userId))
    expect(res400.status).toBe(400)
    expect((await res400.json()).error).toBe('expired')
  })

  it('un GET es 405', async () => {
    expect((await FETCH_ANTES(`${base}/v1/link/check`)).status).toBe(405)
  })

  it('el límite es por cuenta: 20 por hora, y el 21 es 429 sin tocar a otra cuenta', async () => {
    const otra = randomUUID()
    for (let i = 0; i < 20; i++) {
      expect((await check({ user_code: 'ZZZZ-ZZZZ' }, jwtDe(otra))).status).toBe(404)
    }
    const res = await check({ user_code: 'ZZZZ-ZZZZ' }, jwtDe(otra))
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('rate_limited')
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)

    // Misma IP, otra cuenta: su balde está intacto.
    const r = await iniciarVinculacion(pool, Date.now())
    expect((await check({ user_code: r.codigoDeUsuario }, jwtDe(userId))).status).toBe(200)
  })
})

describe('approve aplica la red del plan pago antes de atar el pedido (Ruling P1)', () => {
  it('cuenta que pagó en Supabase y el servicio no conoce: check ok, approve, poll vinculado', async () => {
    process.env.SUPABASE_URL = 'https://ejemplo.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-key-de-prueba'
    // Sólo se interceptan las llamadas a Supabase; las del test al servicio van por el fetch real.
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url)
      if (!u.startsWith('https://ejemplo.supabase.co')) return FETCH_ANTES(url, init)
      return new Response(JSON.stringify(u.includes('/rest/v1/profiles') ? [{ plan: 'cloud' }] : []),
        { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    const pagador = randomUUID()
    const ahora = Date.now()
    const r = await iniciarVinculacion(pool, ahora)

    const resCheck = await check({ user_code: r.codigoDeUsuario }, jwtDe(pagador))
    expect(await resCheck.json()).toMatchObject({ eligibility: 'ok', plan: 'cloud' })
    const resApprove = await post('/v1/link/approve', { user_code: r.codigoDeUsuario }, jwtDe(pagador))
    expect(resApprove.status).toBe(200)
    expect(await resApprove.json()).toEqual({ ok: true })

    // El poll no lleva JWT: lo que lo deja pasar es lo que approve escribió.
    delete process.env.SUPABASE_URL
    global.fetch = FETCH_ANTES
    const resPoll = await post('/v1/link/poll', { device_code: r.codigoDeDispositivo })
    expect(resPoll.status).toBe(200)
    expect((await resPoll.json()).status).toBe('linked')
  })
})
