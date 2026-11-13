// Spec 2b-2 §4.5 de punta a punta: la ruta, la firma y lo que queda en la base.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { getPool, migrate } from '../src/db'
import { createApp } from '../src/http'

const pool = getPool()
const SECRETO = 'test-secret-plan-sync'
const SECRETO_ANTES = process.env.PLAN_SYNC_SECRET
let base: string
let server: ReturnType<typeof createApp>

beforeAll(async () => {
  await migrate(pool)
  server = createApp(pool)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(() => { process.env.PLAN_SYNC_SECRET = SECRETO })
afterAll(async () => {
  if (SECRETO_ANTES === undefined) delete process.env.PLAN_SYNC_SECRET
  else process.env.PLAN_SYNC_SECRET = SECRETO_ANTES
  await new Promise<void>((r) => server.close(() => r()))
  await pool.end()
})

process.env.PLAN_SYNC_SECRET = SECRETO

const ahora = () => Math.floor(Date.now() / 1000)
function avisar(cuerpo: string, opts: { t?: number; secreto?: string; firma?: string | null } = {}) {
  const t = opts.t ?? ahora()
  const v1 = createHmac('sha256', opts.secreto ?? SECRETO).update(`${t}.${cuerpo}`).digest('hex')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.firma !== null) headers['X-Nest-Signature'] = opts.firma ?? `t=${t},v1=${v1}`
  return fetch(`${base}/internal/plan`, { method: 'POST', headers, body: cuerpo })
}
const cuerpo = (userId: string, plan: string) => JSON.stringify({ user_id: userId, plan })

async function estado(userId: string) {
  const { rows: u } = await pool.query('select plan from users where id = $1', [userId])
  const { rows: a } = await pool.query('select 1 from allowlist where user_id = $1', [userId])
  return { plan: (u[0]?.plan as string | undefined) ?? null, enAllowlist: a.length > 0 }
}

describe('POST /internal/plan', () => {
  it('firma válida y plan pago: crea el usuario, le pone el plan y lo mete en la allowlist', async () => {
    const userId = randomUUID()
    const res = await avisar(cuerpo(userId, 'cloud'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await estado(userId)).toEqual({ plan: 'cloud', enAllowlist: true })
  })

  it('es idempotente', async () => {
    const userId = randomUUID()
    expect((await avisar(cuerpo(userId, 'cloud'))).status).toBe(200)
    expect((await avisar(cuerpo(userId, 'cloud'))).status).toBe(200)
    expect(await estado(userId)).toEqual({ plan: 'cloud', enAllowlist: true })
  })

  it('bajar a free baja el plan pero no saca de la allowlist', async () => {
    const userId = randomUUID()
    await avisar(cuerpo(userId, 'cloud'))
    expect((await avisar(cuerpo(userId, 'free'))).status).toBe(200)
    expect(await estado(userId)).toEqual({ plan: 'free', enAllowlist: true })
  })

  it('free para alguien que nunca pagó no lo mete en la allowlist', async () => {
    const userId = randomUUID()
    expect((await avisar(cuerpo(userId, 'free'))).status).toBe(200)
    expect(await estado(userId)).toEqual({ plan: 'free', enAllowlist: false })
  })

  it('firma vieja (> 300 s), inválida o ausente: 401 y nada escrito', async () => {
    const userId = randomUUID()
    const c = cuerpo(userId, 'cloud')
    expect((await avisar(c, { t: ahora() - 301 })).status).toBe(401)
    expect((await avisar(c, { secreto: 'otro' })).status).toBe(401)
    expect((await avisar(c, { firma: null })).status).toBe(401)
    expect(await estado(userId)).toEqual({ plan: null, enAllowlist: false })
  })

  it('plan inválido: 400', async () => {
    const res = await avisar(cuerpo(randomUUID(), 'diamante'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_plan' })
  })

  // Review Focus 5.
  it('user_id que no es uuid o cuerpo que no es JSON: 400, no 500', async () => {
    const r1 = await avisar(JSON.stringify({ user_id: 'u-1', plan: 'cloud' }))
    expect(r1.status).toBe(400)
    expect(await r1.json()).toEqual({ error: 'invalid_user_id' })
    const r2 = await avisar('no es json')
    expect(r2.status).toBe(400)
    expect(await r2.json()).toEqual({ error: 'bad_json' })
  })

  it('GET: 405', async () => {
    const res = await fetch(`${base}/internal/plan`)
    expect(res.status).toBe(405)
  })

  it('sin PLAN_SYNC_SECRET la ruta no existe: 404', async () => {
    delete process.env.PLAN_SYNC_SECRET
    const res = await avisar(cuerpo(randomUUID(), 'cloud'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })
})
