// El MCP del paquete portátil en una máquina SIN Nest: tiene que poder escribir.
//
// Hasta el 2026-10-02 `npx nest-memory mcp` usaba el cliente de sólo lectura, así que en una
// máquina que nunca tuvo Nest no servía para nada: no había base que leer —nadie la creaba— y
// `memory_save` se rechazaba con "abrí Nest". El §5.2/§6 del spec del portátil dice lo
// contrario: el paquete escribe su base local con el MISMO `save()` que Nest, y encola en el
// `mutation_log` para cuando haya quien sincronice.
//
// Se prueba por `callTool`, que es exactamente el camino de un agente.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryLocalClient } from '../memory-mcp/local'
import { callTool } from '../memory-mcp/servidor'
import { MemoryStore } from '../memory-store'

let dir: string
let dbPath: string
let cwd: string
let client: MemoryLocalClient

beforeEach(() => {
  dir = makeTmpDir('nest-mcp-local-')
  dbPath = join(dir, '.nest-memory', 'memory.db')
  cwd = join(dir, 'un-repo')
  mkdirSync(cwd, { recursive: true })
  client = new MemoryLocalClient(dbPath, () => null)
})

afterEach(() => {
  client.close()
  cleanupTmp(dir)
})

describe('MemoryLocalClient — el MCP sin Nest', () => {
  it('guardar crea la base si no existía', async () => {
    expect(existsSync(dbPath)).toBe(false)
    const r = JSON.parse(await callTool(client, cwd, 'memory_save', {
      title: 'npx es npx.cmd en Windows', content: 'por eso va con cmd /c', type: 'decision',
    }))
    expect(r.syncId).toEqual(expect.any(String))
    expect(existsSync(dbPath)).toBe(true)
  })

  it('lo guardado se encuentra después', async () => {
    await callTool(client, cwd, 'memory_save', { title: 'El deploy va por release.yml', content: 'nunca build.yml', type: 'decision' })
    const r = JSON.parse(await callTool(client, cwd, 'memory_search', { query: 'deploy' }))
    expect(r.items.map((i: { title: string }) => i.title)).toContain('El deploy va por release.yml')
  })

  it('buscar sin base todavía devuelve vacío, no un error', async () => {
    const r = JSON.parse(await callTool(client, cwd, 'memory_search', { query: 'algo' }))
    expect(r.items).toEqual([])
  })

  it('la escritura queda encolada para sincronizar (mutation_log)', async () => {
    // Sin Nest y sin cuenta nadie la sube todavía, pero no se pierde: el día que aparezca
    // un daemon —o el paquete con cuenta— la drena de la cola.
    await callTool(client, cwd, 'memory_save', { title: 'encolada', content: 'x', type: 'discovery' })
    client.close()
    const store = new MemoryStore(dbPath)
    try {
      const n = (store as unknown as { db: { prepare(s: string): { get(): { n: number } } } }).db
        .prepare('SELECT COUNT(*) AS n FROM mutation_log').get().n
      expect(n).toBeGreaterThan(0)
    } finally { store.close() }
  })

  it('aplica la misma redacción de secretos que Nest', async () => {
    const clave = 'sk-ant-api03-' + 'a'.repeat(90)
    await callTool(client, cwd, 'memory_save', { title: 'una clave', content: `la clave es ${clave}`, type: 'discovery' })
    const r = JSON.parse(await callTool(client, cwd, 'memory_search', { query: 'clave' }))
    expect(JSON.stringify(r)).not.toContain(clave)
  })

  it('corregir una memoria anda sin Nest', async () => {
    const { syncId } = JSON.parse(await callTool(client, cwd, 'memory_save', { title: 'viejo', content: 'x', type: 'discovery' }))
    await callTool(client, cwd, 'memory_update', { sync_id: syncId, title: 'nuevo' })
    const r = JSON.parse(await callTool(client, cwd, 'memory_get', { sync_id: syncId }))
    expect(r.item.title).toBe('nuevo')
  })
})
