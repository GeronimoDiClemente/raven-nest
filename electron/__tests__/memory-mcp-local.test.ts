// El MCP del paquete portátil en una máquina SIN Nest: tiene que poder escribir.
//
// Hasta el 2026-10-02 `npx nest-memory mcp` usaba el cliente de sólo lectura, así que en una
// máquina que nunca tuvo Nest no servía para nada: no había base que leer —nadie la creaba— y
// `memory_save` se rechazaba con "abrí Nest". El §5.2/§6 del spec del portátil dice lo
// contrario: el paquete escribe su base local con el MISMO `save()` que Nest, y encola en el
// `mutation_log` para cuando haya quien sincronice.
//
// Se prueba por `callTool`, que es exactamente el camino de un agente.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryLocalClient } from '../memory-mcp/local'
import { callTool } from '../memory-mcp/servidor'
import { MemoryStore } from '../memory-store'
import { armarDaemonDelPaquete } from '../daemon-del-paquete'
import { SyncDelMcp } from '../sync-del-mcp'
import { guardarCredencial } from '../credencial-del-paquete'
import { lockPathParaBase } from '../memory-sync-lock'

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

describe('MemoryLocalClient — con sync (§6.2)', () => {
  it('después de escribir llama al gancho; leer no', async () => {
    const trasEscribir = vi.fn()
    const conGancho = new MemoryLocalClient(join(dir, 'g', 'memory.db'), () => null, () => trasEscribir)
    try {
      await callTool(conGancho, cwd, 'memory_search', { query: 'x' })
      expect(trasEscribir).not.toHaveBeenCalled()
      await callTool(conGancho, cwd, 'memory_save', { title: 't', content: 'c', type: 'discovery' })
      expect(trasEscribir).toHaveBeenCalledTimes(1)
    } finally { conGancho.close() }
  })

  it('de punta a punta: memory_save termina en un push al servicio, y suelta el candado', async () => {
    // Todo real —store, daemon, candado, coordinador— menos la red.
    const pedidos: Array<{ url: string; body: string }> = []
    const fetchImpl = vi.fn(async (url: string, init?: { body?: string }) => {
      pedidos.push({ url: String(url), body: String(init?.body ?? '') })
      return { ok: true, status: 200, json: async () => ({ results: [], rows: [], key_epoch: 0 }) }
    }) as unknown as typeof fetch
    const home = join(dir, 'home')
    const base = join(home, '.nest-memory', 'memory.db')
    const safe = {
      isEncryptionAvailable: () => true,
      encryptString: (t: string) => Buffer.from(`##${t}##`),
      decryptString: (b: Buffer) => b.toString().slice(2, -2),
    }
    guardarCredencial(home, safe, { token: 'nmk_x', deviceId: 'd-1' })
    let sync!: SyncDelMcp
    const conSync = new MemoryLocalClient(base, () => null, (store) => {
      const { daemon, hayCuenta } = armarDaemonDelPaquete({ store, dbPath: base, home, baseUrl: 'https://sync.example', safe, fetchImpl })
      sync = new SyncDelMcp(daemon, hayCuenta)
      sync.alArrancar()
      return () => sync.trasEscribir()
    })
    try {
      await callTool(conSync, cwd, 'memory_save', { title: 'sube a la nube', content: 'c', type: 'decision' })
      await sync.enCurso()
      const push = pedidos.find((p) => /push/.test(p.url))
      expect(push, `pedidos: ${pedidos.map((p) => p.url).join(', ')}`).toBeDefined()
      expect(push!.body).toContain('sube a la nube')
      expect(existsSync(lockPathParaBase(base))).toBe(false)
    } finally { conSync.close() }
  })

  it('una cuenta que cifra, sin la maestra en esta máquina: NO sube nada en claro', async () => {
    // El estado exacto de un paquete recién logueado y sin autorizar. El gate fail-closed del
    // daemon (`isEncryptionExpected`) es lo único entre esto y subir título y contenido
    // legibles a una cuenta que el usuario cree cifrada.
    const pedidos: string[] = []
    const fetchImpl = vi.fn(async (_url: string, init?: { body?: string }) => {
      pedidos.push(String(init?.body ?? ''))
      return { ok: true, status: 200, json: async () => ({ results: [], rows: [], key_epoch: 1 }) }
    }) as unknown as typeof fetch
    const home = join(dir, 'home-cifrada')
    const base = join(home, '.nest-memory', 'memory.db')
    const safe = {
      isEncryptionAvailable: () => true,
      encryptString: (t: string) => Buffer.from(`##${t}##`),
      decryptString: (b: Buffer) => b.toString().slice(2, -2),
    }
    guardarCredencial(home, safe, { token: 'nmk_x', deviceId: 'd-1' })
    let sync!: SyncDelMcp
    const cliente = new MemoryLocalClient(base, () => null, (store) => {
      store.rememberKeyEpoch(1)
      const { daemon, hayCuenta } = armarDaemonDelPaquete({ store, dbPath: base, home, baseUrl: 'https://sync.example', safe, fetchImpl })
      sync = new SyncDelMcp(daemon, hayCuenta)
      return () => sync.trasEscribir()
    })
    try {
      await callTool(cliente, cwd, 'memory_save', { title: 'secreto de la empresa', content: 'contenido sensible', type: 'decision' })
      await sync.enCurso()
      // Que haya hablado con el servicio: si no, el test pasaría por no hacer nada.
      expect(pedidos.length).toBeGreaterThan(0)
      for (const body of pedidos) {
        expect(body).not.toContain('secreto de la empresa')
        expect(body).not.toContain('contenido sensible')
      }
    } finally { cliente.close() }
  })
})
