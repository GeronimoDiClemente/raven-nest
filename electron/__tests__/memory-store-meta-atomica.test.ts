import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { makeTmpDir, cleanupTmp } from './setup'

/**
 * Las escrituras de `meta` que son leer-y-después-escribir, con DOS stores sobre la misma base.
 *
 * Un solo hilo de JS no intercala dos métodos sincrónicos solo, así que el intercalado se
 * fuerza: un spy en el punto exacto entre la lectura y la escritura hace que el OTRO store
 * escriba ahí, o devuelve el valor viejo que un segundo proceso habría leído antes de que el
 * primero escribiera. Es el mismo hueco que abren dos procesos de verdad (Nest y
 * `npx nest-memory`), sin depender de ganar una carrera.
 *
 * Dos instancias en este proceso SÍ son dos conexiones a SQLite con sus propios locks: lo que
 * no comparten es el lock de escritura, que es justo lo que se prueba acá. (El test de
 * `memory-store-dos-procesos` necesita un hijo real porque lo suyo era un contador en memoria.)
 */
describe('meta: leer-y-escribir atómico entre dos stores', () => {
  let dir: string
  let dbPath: string
  let a: MemoryStore
  let b: MemoryStore

  const metaDe = (s: MemoryStore, key: string): string | null =>
    (s as unknown as { metaGet(k: string): string | null }).metaGet(key)

  /** Que el store que tiene que esperar no espere 5 segundos en un test de un solo hilo. */
  const esperaCorta = (s: MemoryStore): void => {
    ;(s as unknown as { db: { pragma(p: string): unknown } }).db.pragma('busy_timeout = 50')
  }

  beforeEach(() => {
    dir = makeTmpDir('nest-meta-atomica-')
    dbPath = join(dir, 'memory.db')
    a = new MemoryStore(dbPath)
    a.ensureProject({ projectKey: 'p', displayName: 'p' })
    b = new MemoryStore(dbPath)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    a.close()
    b.close()
    cleanupTmp(dir)
  })

  it('known_key_epoch no baja si el otro proceso leyó la época vieja', () => {
    a.rememberKeyEpoch(5)
    // B leyó 0 antes de que A escribiera el 5, y ahora escribe su 3.
    vi.spyOn(b, 'knownKeyEpoch').mockReturnValue(0)
    b.rememberKeyEpoch(3)

    expect(a.knownKeyEpoch()).toBe(5)
  })

  it('known_key_epoch sigue subiendo y no acepta basura', () => {
    a.rememberKeyEpoch(2)
    b.rememberKeyEpoch(4)
    a.rememberKeyEpoch(Number.NaN)
    a.rememberKeyEpoch(-1)
    expect(b.knownKeyEpoch()).toBe(4)
  })

  it('lamport_high_water no baja si el otro proceso leyó la marca vieja', () => {
    const fila = (syncId: string, lamport: number) => ({
      syncId, projectKey: 'p', scope: 'personal', topicKey: null, type: 'decision',
      title: syncId, content: 'x', updatedAt: 1, lamport, deleted: false,
    })
    a.applyIncomingObservation(fila('s-10', 10))
    // B leyó la marca ANTES de que A escribiera el 10: para B sigue sin haber marca.
    const original = (b as unknown as { metaGet(k: string): string | null }).metaGet.bind(b)
    vi.spyOn(b as unknown as { metaGet(k: string): string | null }, 'metaGet')
      .mockImplementation((k: string) => (k === 'lamport_high_water' ? null : original(k)))
    b.applyIncomingObservation(fila('s-8', 8))

    expect(metaDe(a, 'lamport_high_water')).toBe('10')
  })

  it('ponerseAlDiaConLaClave corre UNA vez por época aunque dos procesos entren a la vez', () => {
    esperaCorta(b)
    const resultadosDeB: Array<boolean | string> = []
    // B entra justo después de que A pasó el chequeo de "ya estoy al día" y antes de que lo
    // marque: con el chequeo afuera de la transacción, los dos re-bajan todo.
    const backfillOriginal = a.backfillTopicHmacs.bind(a)
    vi.spyOn(a, 'backfillTopicHmacs').mockImplementation(() => {
      try { resultadosDeB.push(b.ponerseAlDiaConLaClave(7)) }
      catch (err) { resultadosDeB.push((err as { code?: string }).code ?? String(err)) }
      return backfillOriginal()
    })

    const deA = a.ponerseAlDiaConLaClave(7)
    vi.restoreAllMocks()
    const deBDespues = b.ponerseAlDiaConLaClave(7)

    const corridas = [deA, ...resultadosDeB, deBDespues].filter((r) => r === true)
    expect(corridas, `A=${deA} B adentro=${JSON.stringify(resultadosDeB)} B después=${deBDespues}`).toHaveLength(1)
    expect(a.knownKeyEpoch()).toBe(7)
  })

  it('setCurrentUser: si el otro proceso reclamó el store en el medio, no explota ni lo pisa', () => {
    a.save({ projectKey: 'p', scope: 'personal', type: 'decision', title: 'sin autor', content: 'x', source: 'mcp' })
    // A vio el store sin dueño; antes de su transacción, B lo reclama con otra cuenta.
    const original = a.getOwnerUserId.bind(a)
    vi.spyOn(a, 'getOwnerUserId').mockImplementation(() => {
      const visto = original()
      b.setCurrentUser('user-b')
      return visto
    })

    const r = a.setCurrentUser('user-a')

    expect(r).toEqual({ claimed: false, adopted: 0 })
    expect(b.getOwnerUserId()).toBe('user-b')
    const autores = (a as unknown as { db: { prepare(s: string): { all(): unknown[] } } }).db
      .prepare('SELECT DISTINCT author_user_id AS u FROM observations')
      .all() as Array<{ u: string | null }>
    expect(autores.map((x) => x.u)).toEqual(['user-b'])
  })
  // No es `meta`, pero es el mismo hueco: `ensureProject` hacía SELECT y después un INSERT a
  // secas. Dos procesos que registran el mismo proyecto del roster a la vez (`status` corre en
  // los dos, con o sin candado) hacían que el segundo explotara con UNIQUE, y `doStatus`
  // perdía el resto del roster hasta el próximo ciclo.
  it('ensureProject no explota si el otro proceso insertó el proyecto entre su SELECT y su INSERT', () => {
    a.ensureProject({ projectKey: 'q', displayName: 'q' })
    // B hizo su SELECT antes de que A insertara: para B el proyecto no existe todavía.
    const db = (b as unknown as { db: { prepare(sql: string): { get(...a: unknown[]): unknown } } }).db
    const prepareOriginal = db.prepare.bind(db)
    let engañado = false
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const stmt = prepareOriginal(sql)
      if (!engañado && sql.startsWith('SELECT display_name, root_path, remote_url FROM projects')) {
        engañado = true
        return { ...stmt, get: () => undefined } as typeof stmt
      }
      return stmt
    })

    expect(() => b.ensureProject({ projectKey: 'q', displayName: 'Nombre real' })).not.toThrow()
    // Y lo que B traía de mejor no se pierde: el marcador se reemplaza por el nombre real.
    expect(a.listProjects().find((p) => p.projectKey === 'q')?.displayName).toBe('Nombre real')
  })
})
