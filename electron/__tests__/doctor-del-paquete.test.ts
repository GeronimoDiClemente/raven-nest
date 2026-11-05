import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryStore } from '../memory-store'
import { abrirSoloLecturaConBetterSqlite3 } from '../sqlite-better'
import { leerDoctorDelPaquete, type DependenciasDeDoctor } from '../doctor-del-paquete'

const dirs: string[] = []
afterEach(() => { while (dirs.length) cleanupTmp(dirs.pop()!) })

function deps(extra: Partial<DependenciasDeDoctor> = {}): DependenciasDeDoctor {
  return {
    home: '/h', homeReal: '/h', homes: ['/h'], versionDeNode: 'v22.12.0',
    base: { modo: 'daemon', socket: 's', token: 't' },
    hayPunteroDeNest: true, llaveroDisponible: true,
    abrirSoloLectura: abrirSoloLecturaConBetterSqlite3,
    ...extra,
  }
}

describe('leerDoctorDelPaquete', () => {
  it('doctor con Node 22.11 es un problema que nombra 22.12', async () => {
    const r = await leerDoctorDelPaquete(deps({ versionDeNode: 'v22.11.0' }))
    expect(r.filas[0]).toMatchObject({ marca: 'falla', etiqueta: 'Node' })
    expect(r.filas[0].detalle).toContain('needs 22.12.0 or newer')
    expect(r.problemas).toBe(1)
  })

  it('doctor con Node 22.12 está bien', async () => {
    const r = await leerDoctorDelPaquete(deps())
    expect(r.filas.map((f) => f.etiqueta)).toEqual(['Node', 'Home', 'Nest', 'Memory', 'Keyring'])
    expect(r.filas[0]).toMatchObject({ marca: 'ok', detalle: 'v22.12.0' })
    expect(r.problemas).toBe(0)
    expect(r.avisos).toBe(0)
  })

  it('doctor lista lo bloqueado con su motivo', async () => {
    const home = makeTmpDir('nest-doctor-')
    dirs.push(home)
    const dbPath = join(home, 'memory.db')
    const store = new MemoryStore(dbPath)
    store.close()
    // Escribe con la base de la app: la sonda es de sólo lectura.
    const { abrirConBetterSqlite3 } = await import('../sqlite-better')
    const w = abrirConBetterSqlite3(dbPath)
    w.prepare('INSERT INTO mutation_log (sync_id, op, payload, created_at, blocked_reason) VALUES (?, ?, ?, ?, ?)')
      .run('obs_1', 'upsert', JSON.stringify({ title: 'X' }), 1, 'team_key_missing')
    w.prepare('INSERT INTO mutation_log (sync_id, op, payload, created_at, blocked_reason) VALUES (?, ?, ?, ?, ?)')
      .run('obs_2', 'upsert', 'no es json', 2, 'project_limit_reached')
    w.prepare('INSERT INTO mutation_log (sync_id, op, payload, created_at, pushed_at, blocked_reason) VALUES (?, ?, ?, ?, ?, ?)')
      .run('obs_3', 'upsert', JSON.stringify({ title: 'ya subida' }), 3, 9, 'team_key_missing')
    w.close()
    const r = await leerDoctorDelPaquete(deps({ base: { modo: 'nest', path: dbPath }, hayPunteroDeNest: false }))
    expect(r.bloqueadas).toEqual([
      { syncId: 'obs_1', titulo: 'X', motivo: 'team_key_missing' },
      { syncId: 'obs_2', titulo: '(untitled)', motivo: 'project_limit_reached' },
    ])
    expect(r.avisos).toBe(1)
  })

  it('doctor sin nada bloqueado no suma avisos', async () => {
    const home = makeTmpDir('nest-doctor-')
    dirs.push(home)
    const dbPath = join(home, 'memory.db')
    new MemoryStore(dbPath).close()
    const r = await leerDoctorDelPaquete(deps({ base: { modo: 'nest', path: dbPath }, hayPunteroDeNest: false }))
    expect(r.bloqueadas).toEqual([])
    expect(r.avisos).toBe(0)
  })

  it('en modo daemon no abre ninguna base', async () => {
    const r = await leerDoctorDelPaquete(deps({ abrirSoloLectura: () => { throw new Error('no debía abrir') } }))
    expect(r.bloqueadas).toEqual([])
  })
})
