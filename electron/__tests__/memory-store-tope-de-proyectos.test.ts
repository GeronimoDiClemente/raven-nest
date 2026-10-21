// Spec 2b-1 §4.3: qué repos quedaron sólo en esta máquina por el tope del plan, y con qué
// nombre se los muestra. Lectura nueva sobre datos que ya existen: sin migración.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryStore } from '../memory-store'

let dir: string
let store: MemoryStore

beforeEach(() => {
  dir = makeTmpDir('ms-tope-')
  store = new MemoryStore(join(dir, 'memory.db'))
})
afterEach(() => {
  store.close()
  cleanupTmp(dir)
})

/** Guarda `n` memorias en el proyecto y retiene sus mutaciones con `reason`. */
function guardarYRetener(projectKey: string, n: number, reason = 'project_limit_reached'): void {
  for (let i = 0; i < n; i++) {
    store.save({ projectKey, type: 'decision', title: `${projectKey} ${i}`, content: `content for ${projectKey} number ${i}`, source: 'mcp' })
  }
  const propias = store.pendingMutations(10_000).filter((m) => JSON.parse(m.payload).project_key === projectKey)
  store.blockMutations(propias.map((m) => ({ seq: m.seq, reason })))
}

const db = () => (store as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): unknown } } }).db

describe('proyectosRetenidosPor', () => {
  it('agrupa por proyecto, más retenidas primero, con el nombre local', () => {
    store.ensureProject({ projectKey: 'k-api', displayName: 'api' })
    store.ensureProject({ projectKey: 'k-web', displayName: 'web' })
    guardarYRetener('k-api', 2)
    guardarYRetener('k-web', 5)

    expect(store.proyectosRetenidosPor('project_limit_reached')).toEqual([
      { projectKey: 'k-web', name: 'web', count: 5 },
      { projectKey: 'k-api', name: 'api', count: 2 },
    ])
  })

  it('__global__ nunca aparece: no ocupa lugar en la nube', () => {
    guardarYRetener('__global__', 3)
    expect(store.proyectosRetenidosPor('project_limit_reached')).toEqual([])
  })

  it('sólo cuenta el motivo pedido', () => {
    store.ensureProject({ projectKey: 'k-api', displayName: 'api' })
    guardarYRetener('k-api', 2, 'quota_exceeded')
    expect(store.proyectosRetenidosPor('project_limit_reached')).toEqual([])
  })

  it('una desbloqueada ya no cuenta', () => {
    store.ensureProject({ projectKey: 'k-api', displayName: 'api' })
    guardarYRetener('k-api', 2)
    store.unblockMutations(['project_limit_reached'])
    expect(store.proyectosRetenidosPor('project_limit_reached')).toEqual([])
  })

  it('un payload ilegible se saltea sin romper el resto (Review Focus 5)', () => {
    store.ensureProject({ projectKey: 'k-api', displayName: 'api' })
    guardarYRetener('k-api', 1)
    db().prepare(
      "INSERT INTO mutation_log (sync_id, op, payload, created_at, blocked_reason) VALUES ('roto', 'upsert', '{roto', 1, 'project_limit_reached')",
    ).run()
    db().prepare(
      "INSERT INTO mutation_log (sync_id, op, payload, created_at, blocked_reason) VALUES ('nulo', 'upsert', 'null', 1, 'project_limit_reached')",
    ).run()
    expect(store.proyectosRetenidosPor('project_limit_reached')).toEqual([{ projectKey: 'k-api', name: 'api', count: 1 }])
  })
})

describe('nombresDeProyectos (Review Focus 4)', () => {
  it('respeta el orden pedido y usa el display_name local', () => {
    store.ensureProject({ projectKey: 'k-b', displayName: 'b' })
    store.ensureProject({ projectKey: 'k-a', displayName: 'a' })
    expect(store.nombresDeProyectos(['k-b', 'k-a'])).toEqual([
      { projectKey: 'k-b', name: 'b' },
      { projectKey: 'k-a', name: 'a' },
    ])
    expect(store.nombresDeProyectos([])).toEqual([])
  })

  it('con el marcador (vino del roster cifrado) cae a la carpeta del repo', () => {
    store.ensureProject({ projectKey: 'abcdef0123456789', displayName: 'abcdef0123456789', rootPath: 'C:\\repos\\api' })
    store.ensureProject({ projectKey: '0123456789abcdef', displayName: '0123456789abcdef', rootPath: '/home/gero/web/' })
    expect(store.nombresDeProyectos(['abcdef0123456789', '0123456789abcdef']).map((p) => p.name)).toEqual(['api', 'web'])
  })

  it('sin nombre ni carpeta, la key corta — nunca el hash entero', () => {
    store.ensureProject({ projectKey: 'fedcba9876543210', displayName: 'fedcba9876543210' })
    expect(store.nombresDeProyectos(['fedcba9876543210', 'no-registrado-123'])).toEqual([
      { projectKey: 'fedcba9876543210', name: 'fedcba98' },
      { projectKey: 'no-registrado-123', name: 'no-regis' },
    ])
  })
})
