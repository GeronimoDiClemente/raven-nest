// Punto 8: las métricas del back-office. El resumen se prueba puro; la consulta y la ruta, contra
// la base real (que comparten 70 archivos en paralelo: por eso se buscan las cuentas propias en
// el resultado en vez de comparar totales).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { getPool, migrate } from '../src/db'
import { createApp } from '../src/http'
import { filasPorCuenta, lunesDe, resumirMetricas, SEMANAS_DE_COHORTE, type FilaDeCuenta } from '../src/metricas'

const DIA = 24 * 60 * 60 * 1000
const AHORA = new Date('2026-11-09T12:00:00Z') // un lunes
const haceDias = (n: number) => new Date(AHORA.getTime() - n * DIA)

function fila(p: Partial<FilaDeCuenta> & { primera: Date }): FilaDeCuenta {
  return { userId: randomUUID(), ultima: null, ultimaActiva: null, maquinas: 1, guardoMemoria: false, ...p }
}

describe('lunesDe', () => {
  it('lleva cualquier día al lunes 00:00 UTC de su semana', () => {
    expect(lunesDe(new Date('2026-11-09T12:00:00Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z')
    expect(lunesDe(new Date('2026-11-15T23:59:00Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z')
    expect(lunesDe(new Date('2026-11-08T00:00:00Z')).toISOString()).toBe('2026-11-02T00:00:00.000Z')
  })
})

describe('resumirMetricas', () => {
  it('cuenta activación, segunda máquina y actividad', () => {
    const m = resumirMetricas([
      fila({ primera: haceDias(40), ultima: haceDias(1), ultimaActiva: haceDias(1), maquinas: 2, guardoMemoria: true }),
      fila({ primera: haceDias(20), ultima: haceDias(10), ultimaActiva: haceDias(10), guardoMemoria: true }),
      // Su única máquina activa hace 2 días quedó revocada: no cuenta como activa.
      fila({ primera: haceDias(5), ultima: haceDias(2), ultimaActiva: null, maquinas: 3 }),
    ], AHORA)
    expect(m).toMatchObject({ cuentas: 3, activadas: 2, segunda_maquina: 2, activas_7d: 1, activas_30d: 2 })
  })

  it('una cuenta que todavía no tuvo N días no cuenta en la vuelta de N días', () => {
    const m = resumirMetricas([
      fila({ primera: haceDias(40), ultima: haceDias(5) }), // volvió a 1, 7 y 30
      fila({ primera: haceDias(10), ultima: haceDias(9) }), // volvió a 1; a 7 no; a 30 no es elegible
      fila({ primera: haceDias(3), ultima: null }), // nunca volvió; sólo elegible a 1
    ], AHORA)
    expect(m.vueltas).toEqual([
      { dias: 1, elegibles: 3, volvieron: 2 },
      { dias: 7, elegibles: 2, volvieron: 1 },
      { dias: 30, elegibles: 1, volvieron: 1 },
    ])
  })

  it('arma las cohortes por la semana de la primera máquina, la más nueva primero', () => {
    const m = resumirMetricas([
      fila({ primera: new Date('2026-11-09T01:00:00Z'), guardoMemoria: true }),
      fila({ primera: new Date('2026-11-08T23:00:00Z'), maquinas: 2 }),
      fila({ primera: new Date('2026-11-03T10:00:00Z') }),
      fila({ primera: haceDias(365) }), // fuera de las 8 semanas
    ], AHORA)
    expect(m.cohortes).toHaveLength(SEMANAS_DE_COHORTE)
    expect(m.cohortes[0]).toMatchObject({ semana: '2026-11-09', cuentas: 1, activadas: 1, segunda_maquina: 0 })
    expect(m.cohortes[1]).toMatchObject({ semana: '2026-11-02', cuentas: 2, activadas: 0, segunda_maquina: 1 })
    expect(m.cohortes.reduce((s, c) => s + c.cuentas, 0)).toBe(3)
    expect(m.cuentas).toBe(4)
  })

  it('sin cuentas da ceros, no NaN ni excepciones', () => {
    const m = resumirMetricas([], AHORA)
    expect(m).toMatchObject({ cuentas: 0, activadas: 0, segunda_maquina: 0, activas_7d: 0, activas_30d: 0 })
    expect(m.vueltas.every((v) => v.elegibles === 0 && v.volvieron === 0)).toBe(true)
  })
})

const pool = getPool()
const SECRETO = 'test-secret-metricas'
const SECRETO_ANTES = process.env.PLAN_SYNC_SECRET
let base: string
let server: ReturnType<typeof createApp>

beforeAll(async () => {
  await migrate(pool)
  process.env.PLAN_SYNC_SECRET = SECRETO
  server = createApp(pool)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  if (SECRETO_ANTES === undefined) delete process.env.PLAN_SYNC_SECRET
  else process.env.PLAN_SYNC_SECRET = SECRETO_ANTES
  await new Promise<void>((r) => server.close(() => r()))
  await pool.end()
})

async function cuentaConMaquinas(maquinas: { creada: string; vista: string | null; revocada?: boolean }[]) {
  const userId = randomUUID()
  await pool.query('insert into users (id) values ($1)', [userId])
  for (const m of maquinas) {
    await pool.query(
      `insert into devices (id, user_id, name, token_hash, created_at, last_seen_at, revoked_at)
       values ($1, $2, 'm', $3, $4, $5, $6)`,
      [randomUUID(), userId, randomUUID(), m.creada, m.vista, m.revocada ? m.vista : null],
    )
  }
  return userId
}

describe('filasPorCuenta', () => {
  it('una fila por cuenta, con la primera máquina, la última vista y si guardó', async () => {
    const conMemoria = await cuentaConMaquinas([
      { creada: '2026-10-01T00:00:00Z', vista: '2026-10-20T00:00:00Z' },
      { creada: '2026-10-05T00:00:00Z', vista: '2026-11-01T00:00:00Z', revocada: true },
    ])
    const { rows: [p] } = await pool.query(
      `insert into projects (user_id, project_key, display_name) values ($1, $2, 'p') returning id`,
      [conMemoria, `metricas-${randomUUID()}`],
    )
    await pool.query(
      `insert into observations (sync_id, project_id, project_seq, scope, type, title, author_id,
         lamport, client_updated_at, client_created_at, deleted)
       values ($1, $2, 1, 'personal', 'note', 't', $3, 1, now(), now(), true)`,
      [`obs-metricas-${randomUUID()}`, p.id, conMemoria],
    )
    const sinMemoria = await cuentaConMaquinas([{ creada: '2026-11-01T00:00:00Z', vista: null }])
    const soloPlan = randomUUID()
    await pool.query('insert into users (id, plan) values ($1, $2)', [soloPlan, 'cloud'])

    const filas = await filasPorCuenta(pool)
    const deCuenta = (id: string) => filas.filter((f) => f.userId === id)
    const [a] = deCuenta(conMemoria)
    expect(a.primera.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(a).toMatchObject({ maquinas: 2, guardoMemoria: true })
    expect(a.ultima?.toISOString()).toBe('2026-11-01T00:00:00.000Z') // la revocada también cuenta
    expect(a.ultimaActiva?.toISOString()).toBe('2026-10-20T00:00:00.000Z') // pero no como activa
    const [b] = deCuenta(sinMemoria)
    expect(b).toMatchObject({ maquinas: 1, guardoMemoria: false, ultima: null, ultimaActiva: null })
    // La cuenta que sólo existe por un aviso de plan no tiene máquina: no es una fila.
    expect(deCuenta(soloPlan)).toEqual([])
  })
})

describe('POST /internal/metrics', () => {
  const pedir = (cuerpo: string, opts: { secreto?: string; firma?: string | null; method?: string } = {}) => {
    const t = Math.floor(Date.now() / 1000)
    const v1 = createHmac('sha256', opts.secreto ?? SECRETO).update(`${t}.${cuerpo}`).digest('hex')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (opts.firma !== null) headers['X-Nest-Signature'] = opts.firma ?? `t=${t},v1=${v1}`
    return fetch(`${base}/internal/metrics`, { method: opts.method ?? 'POST', headers, body: cuerpo })
  }
  const PEDIDO = JSON.stringify({ consulta: 'metricas' })

  it('con la firma, devuelve sólo agregados', async () => {
    await cuentaConMaquinas([{ creada: new Date().toISOString(), vista: new Date().toISOString() }])
    const res = await pedir(PEDIDO)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.metricas.cuentas).toBeGreaterThanOrEqual(1)
    expect(body.metricas.activas_7d).toBeGreaterThanOrEqual(1)
    // Nada que identifique a una cuenta: ni uuids ni emails en toda la respuesta.
    expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|@/i)
  })

  it('sin firma o con otro secreto, 401', async () => {
    expect((await pedir(PEDIDO, { firma: null })).status).toBe(401)
    expect((await pedir(PEDIDO, { secreto: 'otro' })).status).toBe(401)
  })

  it('una firma válida de otro cuerpo no sirve para pedir métricas', async () => {
    expect((await pedir('{}')).status).toBe(400)
    expect((await pedir(JSON.stringify({ user_id: randomUUID(), plan: 'cloud' }))).status).toBe(400)
  })

  it('sólo POST', async () => {
    const res = await fetch(`${base}/internal/metrics`)
    expect(res.status).toBe(405)
  })

  it('sin PLAN_SYNC_SECRET la ruta no existe', async () => {
    delete process.env.PLAN_SYNC_SECRET
    try {
      expect((await pedir(PEDIDO)).status).toBe(404)
    } finally {
      process.env.PLAN_SYNC_SECRET = SECRETO
    }
  })
})
