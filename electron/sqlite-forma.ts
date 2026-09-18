// La forma de una base SQLite, sin decir quién la implementa.
//
// Existe para que `MemoryStore` —y las lecturas que cuelgan de él— no nombren a
// `better-sqlite3` en sus tipos. Con eso el MISMO store corre sobre los dos motores: el
// binding nativo dentro de Electron, donde ya está probado, y `node:sqlite` en el paquete
// portátil, donde no se puede compilar nada (spec `2026-09-13-nest-memory-portable-design.md`
// §4 y §5.2).
//
// **Sin imports a propósito**, como `memory-protocol.ts`: cualquier import acá volvería a
// atar el núcleo compartido a un motor, que es justo lo que este archivo deshace.
//
// La forma es la de better-sqlite3 y no un denominador común inventado. Es deliberado: el
// store ya está escrito contra ella y probado contra ella, así que el que tiene que
// adaptarse es el motor nuevo. Un tercer dialecto obligaría a reescribir 2000 líneas que hoy
// funcionan.

export interface SentenciaSqlite {
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
  /**
   * `changes` es `number` y no `number | bigint` porque es lo que better-sqlite3 declara y
   * lo que el store ya suma y devuelve. `node:sqlite` lo tipa mas ancho, asi que su
   * adaptador lo estrecha — para una cuenta de filas afectadas no hay precision que perder.
   */
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
}

/**
 * Lo que devuelve `transaction()`: la función envuelta más los tres modos de `BEGIN`.
 *
 * `immediate` es el único que este repo usa, y no por gusto: con `BEGIN` diferido dos
 * procesos sobre la misma base se pisan al subir de lock y el segundo falla sin poder
 * reintentar. El razonamiento largo está en el constructor de `MemoryStore`.
 */
export interface TransaccionSqlite<A extends unknown[], R> {
  (...args: A): R
  default(...args: A): R
  deferred(...args: A): R
  immediate(...args: A): R
  exclusive(...args: A): R
}

export interface BaseSqlite {
  prepare(sql: string): SentenciaSqlite
  exec(sql: string): void
  pragma(source: string, opts?: { simple?: boolean }): unknown
  transaction<A extends unknown[], R>(fn: (...args: A) => R): TransaccionSqlite<A, R>
  close(): void
}

/**
 * Cómo se abre una base. Es el punto de inyección: `MemoryStore` recibe uno de estos y no
 * sabe —ni tiene por qué— qué motor hay del otro lado.
 */
export type AbridorDeBase = (path: string) => BaseSqlite
