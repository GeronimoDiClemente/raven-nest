// Las tres rutas de vinculación, de punta a punta sobre HTTP. NECESITA POSTGRES.
//
// Se prueban aparte de `link.test.ts` porque lo que puede romperse acá es otra cosa: un
// código de estado equivocado o un campo con otro nombre no se ven en los tests de la lógica
// y rompen igual al cliente.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID, createHmac } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { getPool, migrate } from '../src/db'
import { createApp } from '../src/http'
import { INTERVALO_MS } from '../src/link'

const pool = getPool()
const SECRET = 'secreto-de-prueba'
let base: string
let server: ReturnType<typeof createApp>
let userId: string

/**
 * Un JWT de Supabase firmado con el mismo secreto que lee el servicio.
 *
 * `role` es parámetro porque es lo que separa un login de la ANON KEY, que está firmada con
 * ESE MISMO secreto y viaja pública en el bundle de cualquier cliente.
 */
function jwtDe(userId: string, email: string, role = 'authenticated'): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub: userId, email, role, exp: Math.floor(Date.now() / 1000) + 3600 })
  const firma = createHmac('sha256', SECRET).update(`${head}.${payload}`).digest('base64url')
  return `${head}.${payload}.${firma}`
}

beforeAll(async () => {
  process.env.SUPABASE_JWT_SECRET = SECRET
  await migrate(pool)
  userId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'cloud') on conflict do nothing`, [userId])
  await pool.query('insert into allowlist (user_id) values ($1) on conflict do nothing', [userId])
  server = createApp(pool)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  await pool.end()
})

const post = (path: string, body: unknown, jwt?: string, extra: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), ...extra },
    body: JSON.stringify(body),
  })

const esperarIntervalo = () => new Promise((r) => setTimeout(r, INTERVALO_MS + 50))

describe('POST /v1/link/start', () => {
  it('no pide credenciales: quien llama todavía no tiene ninguna', async () => {
    const r = await post('/v1/link/start', {})
    expect(r.status).toBe(201)
    const j = await r.json()
    expect(j.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(typeof j.device_code).toBe('string')
    expect(j.expires_in).toBeGreaterThan(0)
    expect(j.interval).toBeGreaterThan(0)
  })

  it('rechaza los métodos que no son POST', async () => {
    expect((await fetch(`${base}/v1/link/start`)).status).toBe(405)
  })

  it('guarda el nombre y la plataforma que manda la CLI', async () => {
    const r = await post('/v1/link/start', { name: 'gero-laptop', platform: 'win32' })
    expect(r.status).toBe(201)
    const { user_code } = await r.json()
    const { rows } = await pool.query('select device_name, platform from link_requests where user_code = $1', [user_code])
    expect(rows[0]).toEqual({ device_name: 'gero-laptop', platform: 'win32' })
  })

  it('un JSON roto es 400, no 500', async () => {
    const r = await fetch(`${base}/v1/link/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{roto' })
    expect(r.status).toBe(400)
  })

  it('con TRUST_PROXY=1 el límite va por la IP que agrega el proxy, no por el socket compartido', async () => {
    // Detrás del proxy de Railway todos llegan por el mismo socket: sin esto el balde de 20/h
    // sería uno solo para todo el servicio, y cualquiera lo vaciaría con 20 curl.
    process.env.TRUST_PROXY = '1'
    try {
      const desde = (xff: string) => post('/v1/link/start', {}, undefined, { 'X-Forwarded-For': xff })
      for (let i = 0; i < 20; i++) expect((await desde(`10.9.9.${i}, 203.0.113.7`)).status).toBe(201)
      // La izquierda la controla el cliente: cambiarla no le da un balde nuevo.
      expect((await desde('1.2.3.4, 203.0.113.7')).status).toBe(429)
      expect((await desde('203.0.113.7')).status).toBe(429)
      // Otra persona detrás del mismo proxy tiene su balde intacto.
      expect((await desde('203.0.113.8')).status).toBe(201)
    } finally {
      delete process.env.TRUST_PROXY
    }
  })
})

describe('POST /v1/link/approve', () => {
  it('sin JWT no aprueba nada', async () => {
    const { user_code } = await (await post('/v1/link/start', {})).json()
    expect((await post('/v1/link/approve', { user_code })).status).toBe(401)
  })

  it('con un JWT válido aprueba', async () => {
    const { user_code } = await (await post('/v1/link/start', {})).json()
    const r = await post('/v1/link/approve', { user_code }, jwtDe(userId, 'gero@nestmux.com'))
    expect(r.status).toBe(200)
  })

  it('la anon key de Supabase NO alcanza para aprobar', async () => {
    // Está firmada con el mismo secreto y es pública. Sin este chequeo, cualquiera que lea
    // el bundle de la app puede aprobar vinculaciones a nombre de una cuenta.
    const { user_code } = await (await post('/v1/link/start', {})).json()
    const r = await post('/v1/link/approve', { user_code }, jwtDe(userId, 'g@x.com', 'anon'))
    expect(r.status).toBe(401)
  })

  it('un código que no existe da 404', async () => {
    const r = await post('/v1/link/approve', { user_code: 'ZZZZ-ZZZZ' }, jwtDe(userId, 'g@x.com'))
    expect(r.status).toBe(404)
  })

  it('el límite es por cuenta, 20 por hora, y un 401 no lo gasta', async () => {
    // Sin esto `approve` servía para enumerar códigos con la misma escalera 404/400/409 que
    // `check`, salteando el límite de `check`.
    const otra = randomUUID()
    for (let i = 0; i < 25; i++) {
      expect((await post('/v1/link/approve', { user_code: 'ZZZZ-ZZZZ' }, jwtDe(otra, 'o@x.com', 'anon'))).status).toBe(401)
    }
    for (let i = 0; i < 20; i++) {
      expect((await post('/v1/link/approve', { user_code: 'ZZZZ-ZZZZ' }, jwtDe(otra, 'o@x.com'))).status).toBe(404)
    }
    const res = await post('/v1/link/approve', { user_code: 'ZZZZ-ZZZZ' }, jwtDe(otra, 'o@x.com'))
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('rate_limited')
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    // Otra cuenta, misma IP: intacta.
    expect((await post('/v1/link/approve', { user_code: 'ZZZZ-ZZZZ' }, jwtDe(userId, 'g@x.com'))).status).toBe(404)
  })
})

describe('POST /v1/link/poll', () => {
  it('`res.ok` significa exactamente una cosa: tenés el token', async () => {
    // Mientras espera NO puede ser `ok`. Un cliente que mire sólo eso guardaría un token
    // vacío y creería que quedó vinculado.
    const { user_code, device_code } = await (await post('/v1/link/start', {})).json()

    const esperando = await post('/v1/link/poll', { device_code })
    expect(esperando.ok).toBe(false)
    expect((await esperando.json()).status).toBe('authorization_pending')

    await post('/v1/link/approve', { user_code }, jwtDe(userId, 'gero@nestmux.com'))
    await esperarIntervalo()

    const listo = await post('/v1/link/poll', { device_code })
    expect(listo.ok).toBe(true)
    const j = await listo.json()
    expect(j.status).toBe('linked')
    expect(typeof j.token).toBe('string')
    expect(typeof j.device_id).toBe('string')
  })

  it('el dispositivo queda con el nombre Y la plataforma que manda el cliente', async () => {
    // Hasta el 2026-10-02 el poll leía `name` y tiraba `platform`: las máquinas que entraban
    // por código quedaban con la plataforma vacía, a diferencia de las que entran por
    // `/v1/devices`. Se vio en la prueba de punta a punta del paquete portátil.
    const { user_code, device_code } = await (await post('/v1/link/start', {})).json()
    await post('/v1/link/approve', { user_code }, jwtDe(userId, 'gero@nestmux.com'))
    await esperarIntervalo()
    const listo = await post('/v1/link/poll', { device_code, name: 'la-laptop', platform: 'win32' })
    const { device_id } = await listo.json()
    const { rows } = await pool.query('select name, platform from devices where id = $1', [device_id])
    expect(rows[0]).toEqual({ name: 'la-laptop', platform: 'win32' })
  })

  it('una plataforma que no es texto no se guarda, y no rompe el alta', async () => {
    const { user_code, device_code } = await (await post('/v1/link/start', {})).json()
    await post('/v1/link/approve', { user_code }, jwtDe(userId, 'gero@nestmux.com'))
    await esperarIntervalo()
    const listo = await post('/v1/link/poll', { device_code, platform: { malo: true } })
    expect(listo.ok).toBe(true)
    const { device_id } = await listo.json()
    const { rows } = await pool.query('select platform from devices where id = $1', [device_id])
    expect(rows[0].platform).toBeNull()
  })

  it('preguntar dos veces seguidas da 429 y no el token', async () => {
    const { device_code } = await (await post('/v1/link/start', {})).json()
    await post('/v1/link/poll', { device_code })
    const rapido = await post('/v1/link/poll', { device_code })
    expect(rapido.status).toBe(429)
    expect((await rapido.json()).status).toBe('slow_down')
  })

  it('un código inventado da 410, igual que uno vencido', async () => {
    const r = await post('/v1/link/poll', { device_code: 'no-existe-'.repeat(5) })
    expect(r.status).toBe(410)
  })

  it('sin device_code da 400 y lo dice', async () => {
    const r = await post('/v1/link/poll', {})
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('missing_device_code')
  })
})
