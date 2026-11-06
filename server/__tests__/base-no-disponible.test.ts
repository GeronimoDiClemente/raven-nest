// Qué hace el servicio cuando Postgres no está: `/health` lo dice, y las requests reciben un
// 503 con `Retry-After` en vez de colgarse o de un 500. Y el pool tiene sus dos topes de tiempo.
import { describe, it, expect, afterAll } from 'vitest'
import { Pool } from 'pg'
import type { AddressInfo } from 'node:net'
import { createApp, esBaseNoDisponible } from '../src/http'
import { getPool, migrate, opcionesDelPool } from '../src/db'

const abiertos: Array<() => Promise<void>> = []
afterAll(async () => { for (const c of abiertos) await c() })

async function levantar(pool: Pool) {
  const server = createApp(pool, () => {})
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  abiertos.push(() => new Promise<void>((r) => server.close(() => r())))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('sin base', () => {
  // Un puerto donde no escucha nadie: lo mismo que ve el servicio con Postgres reiniciándose.
  const caida = new Pool({ connectionString: 'postgres://x:y@127.0.0.1:1/nada', connectionTimeoutMillis: 1_000 })
  caida.on('error', () => {})
  abiertos.push(() => caida.end())

  it('/health contesta 503 (antes daba 200 con la base caída)', async () => {
    const base = await levantar(caida)
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(503)
  })

  it('una request de sync recibe 503 con Retry-After, no un 500', async () => {
    const base = await levantar(caida)
    const res = await fetch(`${base}/v1/sync/status`, { headers: { Authorization: 'Bearer nmk_x' } })
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('5')
  })
})

describe('pool lleno', () => {
  it('una request que no consigue conexión falla a tiempo con 503 en vez de esperar para siempre', async () => {
    const chico = new Pool({ ...opcionesDelPool(), max: 1, connectionTimeoutMillis: 300 })
    abiertos.push(() => chico.end())
    const base = await levantar(chico)
    const ocupada = await chico.connect()
    try {
      const t0 = Date.now()
      const res = await fetch(`${base}/v1/sync/status`, { headers: { Authorization: 'Bearer nmk_x' } })
      expect(res.status).toBe(503)
      expect(Date.now() - t0).toBeLessThan(3_000)
    } finally {
      ocupada.release()
    }
  })
})

describe('opcionesDelPool', () => {
  it('trae tope de conexión y de consulta por default, y se pueden ajustar por entorno', () => {
    expect(opcionesDelPool({})).toMatchObject({ connectionTimeoutMillis: 5_000, statement_timeout: 30_000 })
    expect(opcionesDelPool({ PG_STATEMENT_TIMEOUT_MS: '200' }).statement_timeout).toBe(200)
  })

  it('una consulta que pasa el tope se corta, y eso cuenta como base no disponible', async () => {
    const corto = new Pool({ ...opcionesDelPool(), statement_timeout: 200 })
    abiertos.push(() => corto.end())
    const err = await corto.query('select pg_sleep(1)').catch((e) => e)
    expect(err.code).toBe('57014')
    expect(esBaseNoDisponible(err)).toBe(true)
  })

  it('las migraciones apagan el tope para su sesión y lo restauran (crear un índice puede tardar más)', async () => {
    // Un pool falso: el camino rápido falla (base nueva) y el cliente anota lo que se le pide.
    const pedidas: string[] = []
    const cliente = {
      query: async (sql: string) => { pedidas.push(sql.trim().split('\n')[0]!); return { rows: [] } },
      release: () => {},
    }
    const falso = { query: async () => { throw new Error('no existe schema_migrations') }, connect: async () => cliente }
    await migrate(falso as unknown as Pool)
    expect(pedidas[0]).toBe('set statement_timeout = 0')
    // Antes de la primera migración, y restaurado antes de devolver el cliente al pool.
    expect(pedidas.indexOf('set statement_timeout = 0')).toBeLessThan(pedidas.indexOf('begin'))
    expect(pedidas.at(-1)).toBe('reset statement_timeout')
  })
})

describe('esBaseNoDisponible', () => {
  it('no confunde un error de la request con la base caída', () => {
    expect(esBaseNoDisponible(new Error('boom'))).toBe(false)
    expect(esBaseNoDisponible({ code: '23505' })).toBe(false)
    expect(esBaseNoDisponible(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))).toBe(true)
  })
})

// El pool compartido del resto del suite no se usa acá, pero `getPool()` lo arma con el
// listener de error: sin listener, una conexión inactiva perdida tumba el proceso.
describe('getPool', () => {
  it('escucha los errores de conexiones inactivas', async () => {
    const p = getPool()
    expect(p.listenerCount('error')).toBeGreaterThan(0)
    await p.end()
  })
})
