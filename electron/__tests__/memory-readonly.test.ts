// El modo sin daemon: leer la memoria con Nest cerrado.
//
// Es lo que decide si la memoria es una feature del PLUGIN o una función de la APP. Hasta
// ahora el shim se apagaba con "memory is disabled for this session" cuando no encontraba el
// socket, y quien se llevaba el plugin a otro editor se quedaba sin nada.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { MemoryReadonlyClient, SIN_APP, esMetodoDeLectura } from '../memory-mcp/readonly'
import { writeActivePointer, readActivePointer, activePointerPath } from '../memory-active-store'

let home: string

beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'raven-ro-')) })
afterEach(() => { try { rmSync(home, { recursive: true, force: true }) } catch { /* ya no está */ } })

/** Una base real con memorias, en el layout que la app usa. */
function sembrar(userId: string | null = null): string {
  const dir = join(home, '.raven-nest', 'memory', userId ?? '_local')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'memory.db')
  const store = new MemoryStore(path)
  // OJO con el topicKey: guardar dos veces con el MISMO reemplaza por merge (es el
  // comportamiento documentado para un tema que evoluciona), asi que dos memorias distintas
  // necesitan topics distintos. Lo que las conecta aca es la RAMA.
  store.save({
    projectKey: 'raven-nest', type: 'decision', source: 'mcp', gitBranch: 'feat/auth',
    title: 'Auth pasa a cookies de sesión', content: 'El token en localStorage era legible.',
    topicKey: 'auth-cookies', tags: ['auth'],
  })
  store.save({
    projectKey: 'raven-nest', type: 'architecture', source: 'mcp', gitBranch: 'feat/auth',
    title: 'El refresh token se rota', content: 'Cada uso rota el refresh token.',
    topicKey: 'auth-refresh', tags: ['auth'],
  })
  store.close()
  writeActivePointer(home, userId, path)
  return path
}

describe('el puntero de cuenta activa', () => {
  it('se escribe y se vuelve a leer', () => {
    const path = sembrar()
    const p = readActivePointer(home)
    expect(p?.storePath).toBe(path)
    expect(p?.userId).toBeNull()
  })

  it('sin puntero devuelve null, no revienta', () => {
    expect(readActivePointer(home)).toBeNull()
  })

  // Un puntero que sobrevivió a que borren la base es peor que no tener puntero: mandaría a
  // abrir un archivo que no está, y better-sqlite3 lo CREARÍA vacío.
  it('un puntero que apunta a un .db que ya no existe se trata como si no hubiera', () => {
    sembrar()
    const p = readActivePointer(home)!
    rmSync(p.storePath)
    expect(readActivePointer(home)).toBeNull()
  })

  it('un puntero corrupto se trata como si no hubiera', () => {
    mkdirSync(join(home, '.raven-nest', 'memory'), { recursive: true })
    writeFileSync(activePointerPath(home), '{ esto no es json', 'utf8')
    expect(readActivePointer(home)).toBeNull()
  })
})

describe('qué sabe responder sin la app', () => {
  it('el grafo sí', () => {
    expect(esMetodoDeLectura('memory.graph')).toBe(true)
  })

  // Escribir sin el daemon es lo único que este diseño no permite: es quien sincroniza,
  // resuelve conflictos y lleva el lamport. Un segundo escritor sin esa coordinación produce
  // divergencias que el merge no puede arreglar después.
  it('guardar, actualizar y promover NO', () => {
    for (const m of ['memory.save', 'memory.update', 'memory.promote', 'memory.delete'] as const) {
      expect(esMetodoDeLectura(m)).toBe(false)
    }
  })
})

describe('MemoryReadonlyClient', () => {
  it('dibuja el grafo leyendo el disco, sin daemon', async () => {
    sembrar()
    const c = new MemoryReadonlyClient(home)
    const { text } = await c.call<{ text: string }>('memory.graph', {})
    expect(text).toContain('Auth pasa a cookies de sesión')
    expect(text).toContain('El refresh token se rota')
    // Las dos se escribieron en la misma rama, así que tiene que haber una relación dibujada.
    expect(text).toContain('misma rama')
    c.close()
  })

  // Quien lee esto tiene que saber que está mirando una foto del disco, que puede estar
  // atrás de lo que la nube ya tiene.
  it('el dibujo avisa que Nest está cerrado', async () => {
    sembrar()
    const c = new MemoryReadonlyClient(home)
    const { text } = await c.call<{ text: string }>('memory.graph', {})
    expect(text).toMatch(/Nest cerrado/)
    c.close()
  })

  it('filtra por tag', async () => {
    sembrar()
    const c = new MemoryReadonlyClient(home)
    const { text } = await c.call<{ text: string }>('memory.graph', { tag: 'auth' })
    expect(text).toContain('#auth')
    const vacio = await c.call<{ text: string }>('memory.graph', { tag: 'no-existe' })
    expect(vacio.text).toMatch(/No hay memorias que coincidan/)
    c.close()
  })

  // El mensaje tiene que decir qué falta y qué hacer: quien lo lee es un agente que tiene que
  // decidir si reintentar o avisarle al usuario.
  it('escribir dice por qué no puede y qué hacer, no un error de transporte', async () => {
    sembrar()
    const c = new MemoryReadonlyClient(home)
    await expect(c.call('memory.save', {})).rejects.toThrow(SIN_APP)
    await expect(c.call('memory.save', {})).rejects.toThrow(/Nest/)
    c.close()
  })

  it('sin puntero, lo dice en vez de inventar una base vacía', async () => {
    const c = new MemoryReadonlyClient(home)
    await expect(c.call('memory.graph', {})).rejects.toThrow(/no memory database was found/i)
    c.close()
  })

  // `ping` es lo que un caller usa para saber si hay alguien del otro lado. Tiene que
  // contestar igual sin daemon, o el caller concluye que no hay memoria en absoluto.
  it('ping contesta aunque no haya base', async () => {
    const c = new MemoryReadonlyClient(home)
    await expect(c.call('ping', {})).resolves.toEqual({ ok: true })
    c.close()
  })
})
