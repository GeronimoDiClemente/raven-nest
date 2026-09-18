// SQLite sin compilar nada: `node:sqlite` con la forma que el store ya habla.
//
// El obstáculo que hacía inviable publicar la memoria como un paquete de npm era
// `better-sqlite3`: compila un binding contra el ABI de Node, y ese ABI cambia con cada
// versión mayor. `npx` sobre un Node cualquiera es exactamente el escenario donde eso
// explota — este repo ya lo sufre, y `CLAUDE.md` documenta el swap de binarios que hace
// falta para que los tests y la app no se pisen.
//
// `node:sqlite` viene adentro de Node y no compila nada. El costo es un piso de versión:
//
// > **Ojo: `node:sqlite` se agregó en Node v22.5.0, NO en la 20.19.** El spec
// > `2026-09-13-nest-memory-portable-design.md` §4 dice 20.19 —el `engines.node` de este
// > repo— y está equivocado: no hubo backport a la 20.x, que además ya está fuera de
// > soporte. El paquete portátil tiene que pedir >=22.5 y decirlo con un mensaje claro,
// > no con un `MODULE_NOT_FOUND`. Verificado contra la documentación de Node el
// > 2026-09-18. El typecheck de CI corre en Node 20 y no se entera porque sólo necesita
// > los tipos (`@types/node` los trae); el job de tests corre en 22, donde el módulo existe.
//
// **La app de Electron sigue con `better-sqlite3`**, donde ya funciona y está probado.
// Esto es para el paquete portátil, y vive acá —y no en un directorio nuevo— porque acá lo
// alcanzan el typecheck y los tests de CI, igual que `memory-protocol.ts` y `memory-merge.ts`,
// que también son núcleo compartido sin dependencias.
import { DatabaseSync } from 'node:sqlite'

export interface SentenciaSinCompilar {
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
}

/**
 * Lo que devuelve `transaction()`: la función envuelta, más los tres modos de `BEGIN`.
 *
 * Es la forma de better-sqlite3 y se replica tal cual para que el store no cambie ni una
 * línea. `immediate` es el único que se usa de verdad en este repo, y no por gusto: con
 * `BEGIN` diferido dos procesos sobre la misma base se pisan al subir de lock y el segundo
 * falla sin poder reintentar.
 */
export interface TransaccionSinCompilar<A extends unknown[], R> {
  (...args: A): R
  default(...args: A): R
  deferred(...args: A): R
  immediate(...args: A): R
  exclusive(...args: A): R
}

export interface BaseSinCompilar {
  prepare(sql: string): SentenciaSinCompilar
  exec(sql: string): void
  pragma(source: string, opts?: { simple?: boolean }): unknown
  transaction<A extends unknown[], R>(fn: (...args: A) => R): TransaccionSinCompilar<A, R>
  close(): void
  /** Si hay una transacción abierta ahora. Lo usa la reentrancia; se expone porque probar
   *  que NO quedó ninguna abierta es la mitad del valor de este módulo. */
  readonly enTransaccion: boolean
}

export function adaptarBase(db: DatabaseSync): BaseSinCompilar {
  // Los savepoints se numeran, igual que en better-sqlite3. **No es necesario para que
  // funcione** —probado: con un nombre constante pasan los 22 tests, porque `ROLLBACK TO` y
  // `RELEASE` apuntan al savepoint MÁS RECIENTE con ese nombre y el anidado acá es una pila
  // estricta—. Es para que un trace de SQL muestre a qué nivel pertenece cada uno.
  let contadorDeSavepoints = 0

  const adaptada: BaseSinCompilar = {
    prepare(sql) {
      const st = db.prepare(sql)
      return {
        all: (...p) => st.all(...(p as never[])) as unknown[],
        get: (...p) => st.get(...(p as never[])) as unknown,
        run: (...p) => st.run(...(p as never[])),
      }
    },

    exec(sql) { db.exec(sql) },

    pragma(source, opts) {
      const filas = db.prepare(`PRAGMA ${source}`).all() as Array<Record<string, unknown>>
      if (!opts?.simple) return filas
      const primera = filas[0]
      if (!primera) return undefined
      // La PRIMERA COLUMNA, no la que se llama como el pragma: `PRAGMA busy_timeout`
      // devuelve una columna llamada `timeout`, y el store lee ese valor de verdad.
      return Object.values(primera)[0]
    },

    transaction(fn) {
      const correr = <A extends unknown[], R>(begin: string, f: (...a: A) => R, args: A): R => {
        // Reentrante, como better-sqlite3: adentro de otra transacción un `BEGIN` sería un
        // error de SQLite, así que se usa un savepoint. Sin esto, cualquier método del store
        // que llame a otro que también sea transaccional explota.
        if (db.isTransaction) {
          const sp = `nest_sp_${++contadorDeSavepoints}`
          db.exec(`SAVEPOINT ${sp}`)
          try {
            const r = f(...args)
            db.exec(`RELEASE ${sp}`)
            return r
          } catch (err) {
            // `ROLLBACK TO` deshace pero NO saca el savepoint de la pila: sin el `RELEASE`
            // de al lado queda colgado y el siguiente nivel cuenta mal.
            try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`) } catch { /* la externa decide */ }
            throw err
          }
        }
        db.exec(begin)
        try {
          // El COMMIT va ADENTRO del try a propósito: si falla —pasa con la base ocupada por
          // otro proceso— la transacción sigue abierta, y el catch es el único lugar que la
          // cierra. Una transacción abierta bloquea al otro escritor hasta que muera el proceso.
          const r = f(...args)
          db.exec('COMMIT')
          return r
        } catch (err) {
          try { if (db.isTransaction) db.exec('ROLLBACK') } catch { /* ya no había nada que revertir */ }
          throw err
        }
      }

      type A = Parameters<typeof fn>
      type R = ReturnType<typeof fn>
      const envuelta = ((...args: A) => correr('BEGIN', fn, args)) as TransaccionSinCompilar<A, R>
      envuelta.default = (...args: A) => correr('BEGIN', fn, args)
      envuelta.deferred = (...args: A) => correr('BEGIN', fn, args)
      envuelta.immediate = (...args: A) => correr('BEGIN IMMEDIATE', fn, args)
      envuelta.exclusive = (...args: A) => correr('BEGIN EXCLUSIVE', fn, args)
      return envuelta
    },

    close() { db.close() },

    get enTransaccion() { return db.isTransaction },
  }

  return adaptada
}

/** Abre una base en disco con los mismos PRAGMA que usa la app. */
export function abrirBase(path: string): BaseSinCompilar {
  const db = adaptarBase(new DatabaseSync(path))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = FULL')
  db.exec('PRAGMA busy_timeout = 5000')
  return db
}
