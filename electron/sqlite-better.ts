// `better-sqlite3` con la forma de `sqlite-forma.ts`.
//
// Es casi todo paso directo: la forma compartida ES la de better-sqlite3 (ver el encabezado
// de `sqlite-forma.ts`). Este archivo existe para que el tipo calce sin que `memory-store.ts`
// nombre al paquete, no para traducir nada.
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import type { BaseSqlite, TransaccionSqlite } from './sqlite-forma'

export function adaptarBetterSqlite3(db: Database.Database): BaseSqlite {
  return {
    prepare(sql) {
      const st = db.prepare(sql)
      return {
        all: (...p) => st.all(...p) as unknown[],
        get: (...p) => st.get(...p) as unknown,
        run: (...p) => st.run(...p),
      }
    },
    exec(sql) { db.exec(sql) },
    pragma(source, opts) { return db.pragma(source, opts) as unknown },
    transaction<A extends unknown[], R>(fn: (...args: A) => R) {
      // El cast es inevitable: better-sqlite3 tipa `transaction` contra su propio
      // `VariableArgFunction`, que no es genérico en los argumentos como el nuestro.
      return db.transaction(fn as (...args: unknown[]) => R) as unknown as TransaccionSqlite<A, R>
    },
    close() { db.close() },
  }
}

/** El abridor por defecto: el que usa la app dentro de Electron. */
export function abrirConBetterSqlite3(path: string): BaseSqlite {
  mkdirSync(dirname(path), { recursive: true })
  return adaptarBetterSqlite3(new Database(path))
}
