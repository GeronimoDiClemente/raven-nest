// Hueco del 30-oct: un miembro sacado del equipo seguía bajando la memoria del equipo, porque
// `team_memberships` sólo se refrescaba al registrar una máquina. Ahora Supabase avisa cada
// cambio con `POST /internal/memberships`, firmado como `/internal/plan`, con el set COMPLETO
// de membresías activas del usuario en ese momento.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { getPool, migrate } from '../src/db'
import { createApp } from '../src/http'

const pool = getPool()
const SECRETO = 'test-secret-membership-sync'
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
  return fetch(`${base}/internal/memberships`, { method: 'POST', headers, body: cuerpo })
}

type M = { team_id: string; team_name?: string | null; role?: string | null }
const cuerpo = (userId: string, asOf: number, memberships: M[]) =>
  JSON.stringify({ user_id: userId, as_of: asOf, memberships })

async function equipos(userId: string): Promise<string[]> {
  const { rows } = await pool.query(
    `select team_id from team_memberships where user_id = $1 and status = 'active' order by team_id`,
    [userId]
  )
  return rows.map((r) => r.team_id as string)
}

describe('POST /internal/memberships', () => {
  it('reemplaza el espejo con el set que manda Supabase (crea el usuario si no estaba)', async () => {
    const userId = randomUUID()
    const [a, b] = [randomUUID(), randomUUID()].sort()
    const res = await avisar(cuerpo(userId, 1000, [{ team_id: a, team_name: 'A', role: 'member' }, { team_id: b }]))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await equipos(userId)).toEqual([a, b])
  })

  it('sacar al miembro: el set sin ese equipo lo borra del espejo', async () => {
    const userId = randomUUID()
    const equipo = randomUUID()
    await avisar(cuerpo(userId, 1000, [{ team_id: equipo, role: 'member' }]))
    expect((await avisar(cuerpo(userId, 2000, []))).status).toBe(200)
    expect(await equipos(userId)).toEqual([])
  })

  it('un aviso más VIEJO que el último aplicado se ignora (avisos desordenados)', async () => {
    const userId = randomUUID()
    const equipo = randomUUID()
    await avisar(cuerpo(userId, 1000, [{ team_id: equipo }]))
    await avisar(cuerpo(userId, 3000, []))
    const res = await avisar(cuerpo(userId, 2000, [{ team_id: equipo }]))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: 'stale' })
    expect(await equipos(userId)).toEqual([])
  })

  it('firma vieja, inválida o ausente: 401 y nada escrito', async () => {
    const userId = randomUUID()
    const c = cuerpo(userId, 1000, [{ team_id: randomUUID() }])
    expect((await avisar(c, { t: ahora() - 301 })).status).toBe(401)
    expect((await avisar(c, { secreto: 'otro' })).status).toBe(401)
    expect((await avisar(c, { firma: null })).status).toBe(401)
    expect(await equipos(userId)).toEqual([])
  })

  it('cuerpo inválido: 400 con el motivo', async () => {
    const casos: Array<[string, string]> = [
      ['no es json', 'bad_json'],
      [JSON.stringify({ user_id: 'u-1', as_of: 1, memberships: [] }), 'invalid_user_id'],
      [JSON.stringify({ user_id: randomUUID(), as_of: 'ayer', memberships: [] }), 'invalid_as_of'],
      [JSON.stringify({ user_id: randomUUID(), as_of: 1 }), 'invalid_memberships'],
      [JSON.stringify({ user_id: randomUUID(), as_of: 1, memberships: [{ team_id: 'x' }] }), 'invalid_memberships'],
    ]
    for (const [c, error] of casos) {
      const res = await avisar(c)
      expect(res.status, c).toBe(400)
      expect(await res.json()).toEqual({ error })
    }
  })

  it('GET: 405', async () => {
    expect((await fetch(`${base}/internal/memberships`)).status).toBe(405)
  })

  it('sin PLAN_SYNC_SECRET la ruta no existe: 404', async () => {
    delete process.env.PLAN_SYNC_SECRET
    expect((await avisar(cuerpo(randomUUID(), 1, []))).status).toBe(404)
  })
})
