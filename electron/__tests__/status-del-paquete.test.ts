import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryStore } from '../memory-store'
import { abrirSoloLecturaConBetterSqlite3 } from '../sqlite-better'
import { leerStatusDelPaquete, type DependenciasDeStatus } from '../status-del-paquete'

const dirs: string[] = []
afterEach(() => { while (dirs.length) cleanupTmp(dirs.pop()!) })

function baseTemporal(): { dbPath: string; store: MemoryStore; home: string } {
  const home = makeTmpDir('nest-status-')
  dirs.push(home)
  const dbPath = join(home, 'memory.db')
  const store = new MemoryStore(dbPath)
  return { dbPath, store, home }
}

function deps(home: string, dbPath: string, extra: Partial<DependenciasDeStatus> = {}): DependenciasDeStatus {
  return {
    home, homes: [home],
    base: { modo: 'propia', path: dbPath, nueva: false },
    abrirSoloLectura: abrirSoloLecturaConBetterSqlite3,
    llaveroDisponible: true,
    credencial: () => ({ baseUrl: 'https://sync.example' }),
    tieneMaestra: () => true,
    urlDelServicio: (c) => c?.baseUrl ?? 'default',
    urlUpgrade: 'https://nestmux.com/upgrade',
    ...extra,
  }
}

describe('leerStatusDelPaquete', () => {
  it('status de base propia con 2 en cola', async () => {
    const { dbPath, store, home } = baseTemporal()
    store.save({ projectKey: 'k', scope: 'personal', type: 'decision', title: 'uno', content: 'c', source: 'mcp' })
    store.save({ projectKey: 'k', scope: 'personal', type: 'decision', title: 'dos', content: 'c', source: 'mcp' })
    store.close()
    const r = await leerStatusDelPaquete(deps(home, dbPath))
    expect(r.filas[0]).toMatchObject({ marca: 'pendiente', etiqueta: 'Sync' })
    expect(r.filas[0].detalle).toMatch(/^Connected — 2 changes waiting to sync/)
    expect(r.resumen).toBe('2 waiting to sync')
    expect(r.total).toBe(2)
    expect(r.personal).toBe(2)
    expect(r.servicio).toBe('https://sync.example')
    expect(r.recientes).toHaveLength(2)
  })

  it('status en modo daemon', async () => {
    const r = await leerStatusDelPaquete(deps('/h', '/x', { base: { modo: 'daemon', socket: 's', token: 't' } }))
    expect(r.filas).toEqual([{ marca: 'ok', etiqueta: 'Nest', detalle: 'open here — it owns this memory and syncs it live' }])
    expect(r.resumen).toBe('Nest owns this memory')
  })

  it('status de base propia nueva: vacía y dice dónde vivirá', async () => {
    const r = await leerStatusDelPaquete(deps('/h', '/h/.nest-memory/memory.db', { base: { modo: 'propia', path: '/h/.nest-memory/memory.db', nueva: true }, homes: ['/h'] }))
    expect(r.vacia).toBe(true)
    expect(r.guardadaEn).toBe('~/.nest-memory/memory.db')
  })

  it('status cuenta los ilegibles de equipo', async () => {
    const { dbPath, store, home } = baseTemporal()
    store.markUndecryptable('obs_a')
    store.markUndecryptable('obs_b')
    store.markUndecryptableTeam('team-1')
    store.close()
    const r = await leerStatusDelPaquete(deps(home, dbPath))
    expect(r.ilegiblesDeEquipo).toBe(2)
    expect(r.filas).toContainEqual({
      marca: 'aviso', etiqueta: 'Team',
      detalle: "2 encrypted for your team — this machine doesn't have the team key yet",
    })
  })

  it('sin equipos anotados, los ilegibles no son de equipo', async () => {
    const { dbPath, store, home } = baseTemporal()
    store.markUndecryptable('obs_a')
    store.close()
    const r = await leerStatusDelPaquete(deps(home, dbPath))
    expect(r.ilegiblesDeEquipo).toBe(0)
  })
})
