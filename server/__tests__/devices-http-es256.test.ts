// El login asimétrico ENTERO, por HTTP y contra un JWKS que se sirve de verdad. NECESITA
// POSTGRES.
//
// `devices-jwt-es256.test.ts` prueba el verificador con las claves inyectadas a mano. Lo que
// se prueba acá es lo otro: que el servicio SEPA de dónde sacarlas. Esa mitad es la que
// estuvo rota — el verificador nunca vio un JWKS porque nadie lo cableaba— y es invisible
// desde un test unitario, porque ahí las claves se las pasa el test.
//
// El JWKS se sirve desde un servidor HTTP local en vez de mockear `fetch`: así se ejercita la
// URL que arma `jwks.ts`, que es exactamente el detalle que un mock daría por bueno.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { randomUUID, createSign, generateKeyPairSync } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { getPool, migrate } from '../src/db'
import { createApp } from '../src/http'

const pool = getPool()
const par = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const KID = 'kid-de-prueba-es256'

let base: string
let server: ReturnType<typeof createApp>
let supabase: Server
let userId: string

function jwtEs256(sub: string, email: string, opts: { kid?: string; role?: string } = {}): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'ES256', kid: opts.kid ?? KID, typ: 'JWT' })
  const payload = b64({ sub, email, role: opts.role ?? 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })
  const firma = createSign('SHA256')
    .update(`${head}.${payload}`)
    .sign({ key: par.privateKey, dsaEncoding: 'ieee-p1363' }, 'base64url')
  return `${head}.${payload}.${firma}`
}

beforeAll(async () => {
  // Un proyecto de Supabase con claves asimétricas: no hay secreto simétrico que valga.
  delete process.env.SUPABASE_JWT_SECRET
  // Sin la anon key, `registerDevice` no intenta sincronizar `team_memberships` contra este
  // servidor de mentira, que sólo sabe servir el JWKS.
  delete process.env.SUPABASE_ANON_KEY

  const jwk = { ...par.publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'ES256' }
  supabase = createServer((req, res) => {
    if (req.url === '/auth/v1/.well-known/jwks.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ keys: [jwk] }))
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => supabase.listen(0, '127.0.0.1', r))
  process.env.SUPABASE_URL = `http://127.0.0.1:${(supabase.address() as AddressInfo).port}`

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
  await new Promise<void>((r) => supabase.close(() => r()))
  await pool.end()
})

const post = (path: string, body: unknown, jwt?: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  })

describe('POST /v1/devices con un proyecto que firma ES256', () => {
  it('registra el device: es el login que la app emite de verdad', async () => {
    const r = await post('/v1/devices', { name: 'Mac de prueba', platform: 'darwin' }, jwtEs256(userId, 'gero@nest.dev'))
    expect(r.status).toBe(201)
    const cuerpo = (await r.json()) as { device_id: string; token: string }
    expect(cuerpo.token.startsWith('nmk_')).toBe(true)

    const { rows } = await pool.query('select user_id from devices where id = $1', [cuerpo.device_id])
    expect(rows[0].user_id).toBe(userId)
  })

  it('rechaza un kid que el JWKS no publica, sin inventar un 503', async () => {
    const r = await post('/v1/devices', { name: 'x' }, jwtEs256(userId, 'gero@nest.dev', { kid: 'otro-kid' }))
    expect(r.status).toBe(401)
  })

  it('rechaza la anon key aunque venga firmada con la clave buena', async () => {
    const r = await post('/v1/devices', { name: 'x' }, jwtEs256(userId, 'gero@nest.dev', { role: 'anon' }))
    expect(r.status).toBe(401)
  })
})

describe('POST /v1/link/approve con un proyecto que firma ES256', () => {
  it('ata el código a la cuenta, que es el paso que destraba el `npx nest-memory login`', async () => {
    const inicio = await post('/v1/link/start', {})
    const { user_code, device_code } = (await inicio.json()) as { user_code: string; device_code: string }

    const aprobacion = await post('/v1/link/approve', { user_code }, jwtEs256(userId, 'gero@nest.dev'))
    expect(aprobacion.status).toBe(200)

    const reclamo = await post('/v1/link/poll', { device_code })
    expect(reclamo.status).toBe(200)
    const cuerpo = (await reclamo.json()) as { token: string; device_id: string }
    expect(cuerpo.token.startsWith('nmk_')).toBe(true)
  })
})
