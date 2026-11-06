// La línea de log por request: qué lleva, y sobre todo qué no lleva.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { rutaParaLog, registrarRequest, type LineaDeRequest } from '../src/registro-de-requests'

const here = dirname(fileURLToPath(import.meta.url))

async function servir(status: number) {
  const lineas: LineaDeRequest[] = []
  const server = createServer((req, res) => {
    registrarRequest(req, res, (l) => lineas.push(l))
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end('{}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { lineas, base, cerrar: () => new Promise<void>((r) => server.close(() => r())) }
}

describe('rutaParaLog', () => {
  it('una ruta conocida pasa tal cual; la de beta sin su token; cualquier otra, anónima', () => {
    expect(rutaParaLog('/v1/sync/push')).toBe('/v1/sync/push')
    expect(rutaParaLog('/beta/tok_secreto123/Nest.dmg')).toBe('/beta/:x')
    expect(rutaParaLog('/v1/beta/tok_secreto123')).toBe('/v1/beta/:x')
    expect(rutaParaLog('/lo-que-sea/que/mando/alguien')).toBe('(otra)')
  })

  it('conoce todas las rutas que despacha http.ts (si agregás una, sumala a la lista)', () => {
    const http = readFileSync(resolve(here, '../src/http.ts'), 'utf8')
    const rutas = [...http.matchAll(/path === '([^']+)'/g)].map((m) => m[1]!)
    expect(rutas.length).toBeGreaterThan(20)
    for (const r of rutas) expect(rutaParaLog(r), r).toBe(r)
  })
})

describe('registrarRequest', () => {
  it('una línea con método, ruta, status y duración, y el id también en la respuesta', async () => {
    const s = await servir(200)
    try {
      const res = await fetch(`${s.base}/v1/sync/status?token=nmk_no_va`, { headers: { Authorization: 'Bearer nmk_tampoco' } })
      await res.text()
      await new Promise((r) => setTimeout(r, 20))
      expect(s.lineas).toHaveLength(1)
      const l = s.lineas[0]!
      expect(l).toMatchObject({ metodo: 'GET', ruta: '/v1/sync/status', status: 200 })
      expect(l.ms).toBeGreaterThanOrEqual(0)
      expect(res.headers.get('x-request-id')).toBe(l.rid)
      // Ni la query string ni los headers: el token no puede terminar en un log.
      expect(JSON.stringify(l)).not.toContain('nmk_')
    } finally {
      await s.cerrar()
    }
  })

  it('un /health que anda no se registra (el monitor lo llama cada minuto); uno que falla, sí', async () => {
    const ok = await servir(200)
    const mal = await servir(503)
    try {
      await (await fetch(`${ok.base}/health`)).text()
      await (await fetch(`${mal.base}/health`)).text()
      await new Promise((r) => setTimeout(r, 20))
      expect(ok.lineas).toHaveLength(0)
      expect(mal.lineas.map((l) => l.status)).toEqual([503])
    } finally {
      await ok.cerrar()
      await mal.cerrar()
    }
  })
})
