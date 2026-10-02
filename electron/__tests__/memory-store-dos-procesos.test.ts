import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildSync } from 'esbuild'
import { MemoryStore, SCHEMA_VERSION } from '../memory-store'

/**
 * Dos PROCESOS escribiendo la misma base.
 *
 * Es el escenario que el paquete portátil vuelve normal —Nest abierto y un `npx nest-memory`
 * escribiendo al lado— pero que ya pasa hoy sin él: la app instalada y un build de desarrollo
 * abiertos a la vez comparten `~/.raven-nest`.
 *
 * El reloj de Lamport se cargaba UNA vez al abrir (`SELECT MAX`) y se incrementaba en
 * memoria. Dos procesos arrancan del mismo número y emiten lamports duplicados — y el lamport
 * es lo que desempata un conflicto cuando dos escrituras comparten `updated_at`. Duplicarlo
 * no rompe nada visible: hace que el desempate sea arbitrario y que dos máquinas puedan
 * elegir ganadores distintos para el mismo par de filas.
 */
describe('dos procesos sobre la misma base', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nest-dos-proc-'))
    dbPath = join(dir, 'memory.db')
    // La base se crea y se migra una vez, para que los dos procesos la encuentren lista.
    const s = new MemoryStore(dbPath)
    s.ensureProject({ projectKey: 'p', displayName: 'p' })
    expect(s.schemaVersion).toBe(SCHEMA_VERSION)
    s.close()
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  /**
   * Un proceso hijo REAL que escribe con el mismo store. No un segundo `MemoryStore` en este
   * proceso: dos instancias acá comparten el mismo `better-sqlite3` y el mismo heap, así que
   * no reproducirían nada. El bug vive entre procesos.
   *
   * El script se compila con esbuild —que siempre está, viene con vite— y corre con el MISMO
   * node que los tests. Antes era `npx tsx`, que no es dependencia del repo (en una máquina
   * con red `npx` lo bajaba al vuelo) y que en Windows ni arrancaba: `npx` es `npx.cmd` y
   * `execFileSync` da ENOENT.
   */
  const escribirEnOtroProceso = (etiqueta: string, cuantas: number): void => {
    const script = join(dir, `w-${etiqueta}.ts`)
    const modulo = (nombre: string) => JSON.stringify(join(process.cwd(), 'electron', nombre).replace(/\\/g, '/'))
    // El hijo registra el motor nativo igual que `setup.ts` en los workers de vitest: el store
    // no elige motor solo (ver `usarAbridorPorDefecto`) y sin esto lanza al construirse.
    writeFileSync(script, `
      import { MemoryStore } from ${modulo('memory-store.ts')}
      import { usarAbridorPorDefecto } from ${modulo('sqlite-motor.ts')}
      import { abrirConBetterSqlite3 } from ${modulo('sqlite-better.ts')}
      usarAbridorPorDefecto(abrirConBetterSqlite3)
      const store = new MemoryStore(${JSON.stringify(dbPath)})
      for (let i = 0; i < ${cuantas}; i++) {
        store.save({ projectKey: 'p', scope: 'personal', type: 'decision',
          title: '${etiqueta} ' + i, content: 'cuerpo', source: 'mcp' })
      }
      store.close()
    `)
    const salida = join(dir, `w-${etiqueta}.cjs`)
    // Las dependencias quedan afuera del bundle (el binding nativo no se puede empaquetar) y
    // se resuelven contra el node_modules del repo por NODE_PATH.
    buildSync({ entryPoints: [script], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: salida, logLevel: 'silent' })
    execFileSync(process.execPath, [salida], {
      cwd: process.cwd(), stdio: 'pipe',
      env: { ...process.env, NODE_PATH: join(process.cwd(), 'node_modules') },
    })
  }

  it('no emiten lamports duplicados', () => {
    // Un proceso escribe mientras ESTE tiene el store abierto: es el caso real, no dos
    // procesos por turnos.
    const mio = new MemoryStore(dbPath)
    mio.save({ projectKey: 'p', scope: 'personal', type: 'decision', title: 'mía 1', content: 'x', source: 'mcp' })

    escribirEnOtroProceso('otro', 5)

    // Y ahora este proceso sigue escribiendo, con el store que ya tenía abierto.
    mio.save({ projectKey: 'p', scope: 'personal', type: 'decision', title: 'mía 2', content: 'x', source: 'mcp' })
    mio.save({ projectKey: 'p', scope: 'personal', type: 'decision', title: 'mía 3', content: 'x', source: 'mcp' })

    const filas = (mio as unknown as { db: { prepare(s: string): { all(): unknown[] } } }).db
      .prepare('SELECT sync_id, title, lamport FROM observations ORDER BY lamport')
      .all() as Array<{ title: string; lamport: number }>
    mio.close()

    expect(filas).toHaveLength(8)
    const lamports = filas.map((f) => f.lamport)
    expect(new Set(lamports).size, `lamports duplicados: ${JSON.stringify(filas)}`).toBe(filas.length)
    // Y las dos últimas del proceso original quedan DESPUÉS de las del otro: su reloj vio lo
    // que el otro escribió, que es toda la garantía.
    const mias = filas.filter((f) => f.title.startsWith('mía'))
    const otras = filas.filter((f) => f.title.startsWith('otro'))
    expect(Math.max(...mias.map((f) => f.lamport))).toBeGreaterThan(Math.max(...otras.map((f) => f.lamport)))
  }, 120_000)
})
