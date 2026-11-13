// El MISMO MemoryStore, sobre node:sqlite en vez de better-sqlite3.
//
// Es el paso 4 del spec del paquete portátil: "leer y escribir la base de esta máquina, sin
// nube". Lo que se prueba acá no es el adaptador —eso ya tiene sus 22 tests— sino que el
// store real, con su migración, su redacción y su FTS, funciona sin compilar nada. Si esto
// anda, el paquete no tiene que reimplementar nada.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { abrirBase } from '../sqlite-sin-compilar'

const PROY = 'proyecto-de-prueba'

describe('MemoryStore sobre node:sqlite', () => {
  let dir: string
  let store: MemoryStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nest-mem-sc-'))
    store = new MemoryStore(join(dir, 'memory.db'), abrirBase)
  })

  afterEach(() => {
    try { store.close() } catch { /* ya cerrado */ }
    rmSync(dir, { recursive: true, force: true })
  })

  it('usa el abridor que le pasan, y no better-sqlite3', () => {
    // Sin este test los demás son un verde vacío: con el binding nativo correcto instalado,
    // todos pasarían igual aunque el store siguiera abriendo con better-sqlite3 y el
    // parámetro se ignorara. Lo único que prueba que el camino nuevo se usa es contarlo.
    let llamadas = 0
    const abridor = (path: string) => { llamadas++; return abrirBase(path) }
    const otro = new MemoryStore(join(dir, 'otra.db'), abridor)
    try { expect(llamadas).toBe(1) } finally { otro.close() }
  })

  it('migra una base nueva hasta la versión del esquema', () => {
    expect(store.schemaVersion).toBeGreaterThan(0)
  })

  it('guarda y encuentra por FTS', () => {
    store.save({
      projectKey: PROY, type: 'decision', source: 'ui',
      title: 'Elegimos xterm', content: 'El renderer DOM quemaba bateria',
    })
    const r = store.search(PROY, 'bateria')
    expect(r).toHaveLength(1)
    expect(r[0]!.title).toBe('Elegimos xterm')
  })

  it('el lamport sale de la base y avanza escritura a escritura', () => {
    const a = store.save({ projectKey: PROY, type: 'discovery', source: 'ui', title: 'uno', content: 'uno' })
    const b = store.save({ projectKey: PROY, type: 'discovery', source: 'ui', title: 'dos', content: 'dos' })
    const filaA = store.get(a.syncId)!
    const filaB = store.get(b.syncId)!
    expect(filaB.lamport).toBeGreaterThan(filaA.lamport)
  })

  it('redacta secretos, igual que sobre better-sqlite3', () => {
    const r = store.save({
      projectKey: PROY, type: 'discovery', source: 'ui', title: 'token',
      content: `el token es sk-${'A'.repeat(48)}`,
    })
    expect(store.get(r.syncId)!.content).not.toContain('A'.repeat(48))
  })

  it('una transacción que falla no deja la base trabada', () => {
    // El peligro que marca el spec §4: con la base compartida entre procesos, una
    // transacción abierta bloquea al otro escritor hasta que muera el proceso.
    expect(() => store.save({
      projectKey: PROY, type: 'discovery', source: 'ui', title: 'x', content: 'x',
      // @ts-expect-error a propósito: un tipo inválido revienta adentro de la transacción
      scope: { roto: true },
    })).toThrow()
    const ok = store.save({ projectKey: PROY, type: 'discovery', source: 'ui', title: 'despues', content: 'despues' })
    expect(store.get(ok.syncId)!.title).toBe('despues')
  })

  it('el contexto devuelve lo guardado', () => {
    store.save({ projectKey: PROY, type: 'discovery', source: 'ui', title: 'en contexto', content: 'algo' })
    expect(store.context(PROY).map(o => o.title)).toContain('en contexto')
  })

  it('reabrir la base ve lo que escribió la sesión anterior', () => {
    store.save({ projectKey: PROY, type: 'discovery', source: 'ui', title: 'persistido', content: 'persistido' })
    store.close()
    store = new MemoryStore(join(dir, 'memory.db'), abrirBase)
    expect(store.search(PROY, 'persistido')).toHaveLength(1)
  })
})
