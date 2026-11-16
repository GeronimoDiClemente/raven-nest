// Spec §8.2.3: el camino engram -> store -> mutation_log esta testeado por unidad con 2-3
// filas, nunca con el volumen real (el vault de referencia tiene 866 notas). Esto lo corre
// con 900 y verifica las dos propiedades que el onboarding necesita: que entren todas, y
// que importar dos veces no duplique NI genere una segunda tanda de mutaciones para pushear.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryStore } from '../memory-store'
import { importEngramDatabase } from '../memory-importers/engram'

const ROW_COUNT = 900

/** Fixture: una engram.db sintetica con el esquema que el importer lee. */
function buildEngramDb(path: string, rows: number): void {
  const db = new Database(path)
  db.exec(
    'CREATE TABLE observations (' +
      'sync_id TEXT PRIMARY KEY, type TEXT, title TEXT, content TEXT, ' +
      'project TEXT, topic_key TEXT, revision_count INTEGER, duplicate_count INTEGER, ' +
      'last_seen_at TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT)'
  )
  const insert = db.prepare(
    'INSERT INTO observations (sync_id, type, title, content, project, topic_key, ' +
      'revision_count, duplicate_count, last_seen_at, created_at, updated_at, deleted_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, NULL)'
  )
  const txn = db.transaction(() => {
    for (let i = 0; i < rows; i++) {
      // 9 proyectos, como el vault real medido en §2.1.
      const project = 'project-' + (i % 9)
      const stamp = '2026-09-01 10:00:00'
      insert.run('engram-' + i, 'decision', 'Title ' + i, 'Body ' + i, project, null, stamp, stamp, stamp)
    }
  })
  txn()
  db.close()
}

describe('import de engram con volumen real (spec §8.2.3)', () => {
  let dir: string
  let store: MemoryStore
  let engramPath: string

  beforeEach(() => {
    dir = makeTmpDir('raven-import-volume-')
    engramPath = join(dir, 'engram.db')
    buildEngramDb(engramPath, ROW_COUNT)
    store = new MemoryStore(join(dir, 'memory.db'))
  })

  afterEach(() => {
    store.close()
    cleanupTmp(dir)
  })

  it('importa las 900 filas y deja 900 mutaciones para pushear', () => {
    const result = importEngramDatabase(store, engramPath)

    expect(result.error).toBeUndefined()
    expect(result.imported).toBe(ROW_COUNT)
    expect(store.count()).toBe(ROW_COUNT)
    expect(store.pendingMutationCount()).toBe(ROW_COUNT)
  })

  it('importar dos veces no duplica FILAS', () => {
    importEngramDatabase(store, engramPath)

    const second = importEngramDatabase(store, engramPath)

    expect(second.imported).toBe(ROW_COUNT)
    // deriveImportSyncId es determinístico (§8.1): la segunda pasada resuelve por identidad
    // de contenido y no inserta filas nuevas. Esto SI funciona.
    expect(store.count()).toBe(ROW_COUNT)
  })

  // Este test nacio en rojo el 2026-09-09: encontro que `MemoryStore.save()` agregaba una
  // mutacion `upsert` en un re-import aunque no hubiera cambiado NADA (900 filas re-importadas
  // dejaban 1800 mutaciones). Importaba mas de lo que parecia porque `runLocalMemoryImport`
  // corre en CADA ARRANQUE de la app (`main.ts`) y el importer de markdown tambien manda
  // `sourceRef`: cada vez que se abria Nest se re-logueaba y re-pusheaba todo lo importado que
  // no habia cambiado.
  //
  // Arreglado por la Task 13 del plan: ahora Step 0 y Step 0.5 de `save()` comparan el
  // `content_hash` y los tags antes de reescribir, y solo agregan mutacion si cambio algo que
  // REPLICA. Un cambio unicamente de `source_ref` se aplica local y sin mutacion, porque el
  // servidor no tiene esa columna.
  it('importar dos veces no genera una segunda tanda de mutaciones', () => {
    importEngramDatabase(store, engramPath)
    const afterFirst = store.pendingMutationCount()

    importEngramDatabase(store, engramPath)

    expect(store.pendingMutationCount()).toBe(afterFirst)
  })
})
