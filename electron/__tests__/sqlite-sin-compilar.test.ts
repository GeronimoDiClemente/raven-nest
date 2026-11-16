import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { adaptarBase } from '../sqlite-sin-compilar'

function base() {
  const db = adaptarBase(new DatabaseSync(':memory:'))
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, n INTEGER)')
  return db
}

describe('las sentencias', () => {
  it('escribe y lee de vuelta', () => {
    const db = base()
    db.prepare('INSERT INTO t (a, n) VALUES (?, ?)').run('hola', 42)
    expect(db.prepare('SELECT a, n FROM t WHERE a = ?').get('hola')).toEqual({ a: 'hola', n: 42 })
  })

  it('run() informa las filas tocadas y el rowid', () => {
    const db = base()
    const r = db.prepare('INSERT INTO t (a) VALUES (?)').run('x')
    expect(r.changes).toBe(1)
    expect(Number(r.lastInsertRowid)).toBe(1)
  })

  it('get() de una fila que no existe da undefined, no null', () => {
    const db = base()
    expect(db.prepare('SELECT * FROM t WHERE a = ?').get('no')).toBeUndefined()
  })

  it('all() devuelve todas las filas', () => {
    const db = base()
    db.prepare('INSERT INTO t (a) VALUES (?)').run('a')
    db.prepare('INSERT INTO t (a) VALUES (?)').run('b')
    expect(db.prepare('SELECT a FROM t ORDER BY a').all()).toEqual([{ a: 'a' }, { a: 'b' }])
  })

  it('acepta parámetros nombrados sin prefijo, como better-sqlite3', () => {
    const db = base()
    db.prepare('INSERT INTO t (a, n) VALUES ($a, $n)').run({ a: 'uno', n: 1 })
    expect(db.prepare('SELECT n FROM t WHERE a = $a').get({ a: 'uno' })).toEqual({ n: 1 })
  })

  it('exec() corre varias sentencias de una', () => {
    const db = base()
    db.exec("INSERT INTO t (a) VALUES ('p'); INSERT INTO t (a) VALUES ('q');")
    expect(db.prepare('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 2 })
  })
})

describe('pragma', () => {
  it('lee y escribe user_version', () => {
    const db = base()
    db.pragma('user_version = 7')
    expect(db.pragma('user_version', { simple: true })).toBe(7)
  })

  it('sin simple devuelve las filas, como better-sqlite3', () => {
    const db = base()
    db.pragma('user_version = 3')
    expect(db.pragma('user_version')).toEqual([{ user_version: 3 }])
  })

  it('simple toma la PRIMERA COLUMNA aunque no se llame como el pragma', () => {
    // `PRAGMA busy_timeout` devuelve una columna llamada `timeout`. Buscarla por el
    // nombre del pragma daría undefined, y el store lee este valor de verdad.
    const db = base()
    db.pragma('busy_timeout = 4321')
    expect(db.pragma('busy_timeout', { simple: true })).toBe(4321)
  })

  it('un pragma que no devuelve nada da undefined en simple', () => {
    const db = base()
    expect(db.pragma('user_version = 1', { simple: true })).toBeUndefined()
  })
})

describe('transacciones', () => {
  it('confirma y devuelve lo que devolvió la función', () => {
    const db = base()
    const r = db.transaction(() => {
      db.prepare('INSERT INTO t (a) VALUES (?)').run('dentro')
      return 'valor'
    })()
    expect(r).toBe('valor')
    expect(db.prepare('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 1 })
  })

  it('ante una excepción revierte y la vuelve a lanzar', () => {
    const db = base()
    const txn = db.transaction(() => {
      db.prepare('INSERT INTO t (a) VALUES (?)').run('se pierde')
      throw new Error('boom')
    })
    expect(() => txn()).toThrow('boom')
    expect(db.prepare('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 0 })
  })

  it('DESPUÉS de revertir la base sigue usable — no queda una transacción abierta', () => {
    // Es el caso que el spec marca como el peligroso: con la base compartida entre dos
    // procesos, una transacción que queda abierta bloquea al otro escritor.
    const db = base()
    expect(() => db.transaction(() => { throw new Error('boom') })()).toThrow()
    expect(db.enTransaccion).toBe(false)
    db.prepare('INSERT INTO t (a) VALUES (?)').run('despues')
    expect(db.prepare('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 1 })
  })

  it('le pasa los argumentos a la función', () => {
    const db = base()
    const txn = db.transaction((a: string, n: number) => {
      db.prepare('INSERT INTO t (a, n) VALUES (?, ?)').run(a, n)
    })
    txn('arg', 9)
    expect(db.prepare('SELECT a, n FROM t').get()).toEqual({ a: 'arg', n: 9 })
  })

  it('immediate() también confirma y pasa argumentos', () => {
    const db = base()
    const txn = db.transaction((a: string) => {
      db.prepare('INSERT INTO t (a) VALUES (?)').run(a)
      return a.toUpperCase()
    })
    expect(txn.immediate('ya')).toBe('YA')
    expect(db.prepare('SELECT a FROM t').get()).toEqual({ a: 'ya' })
  })

  it('anidada: si las dos salen bien, quedan las dos escrituras', () => {
    const db = base()
    const interna = db.transaction(() => { db.prepare('INSERT INTO t (a) VALUES (?)').run('in') })
    db.transaction(() => {
      db.prepare('INSERT INTO t (a) VALUES (?)').run('out')
      interna()
    })()
    expect(db.prepare('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 2 })
  })

  it('anidada: la interna falla y la externa la atrapa — se pierde SÓLO lo de la interna', () => {
    const db = base()
    const interna = db.transaction(() => {
      db.prepare('INSERT INTO t (a) VALUES (?)').run('in')
      throw new Error('interna')
    })
    db.transaction(() => {
      db.prepare('INSERT INTO t (a) VALUES (?)').run('out')
      try { interna() } catch { /* la externa sigue */ }
    })()
    expect(db.prepare('SELECT a FROM t').all()).toEqual([{ a: 'out' }])
  })

  it('anidada: si falla la externa se pierde todo, incluso lo que la interna confirmó', () => {
    const db = base()
    const interna = db.transaction(() => { db.prepare('INSERT INTO t (a) VALUES (?)').run('in') })
    expect(() => db.transaction(() => {
      interna()
      throw new Error('externa')
    })()).toThrow('externa')
    expect(db.prepare('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 0 })
  })

  it('immediate() anidada NO intenta un BEGIN adentro de otro', () => {
    const db = base()
    const interna = db.transaction(() => { db.prepare('INSERT INTO t (a) VALUES (?)').run('in') })
    expect(() => db.transaction(() => { interna.immediate() })()).not.toThrow()
    expect(db.prepare('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 1 })
  })

  it('la misma transacción se puede correr dos veces seguidas', () => {
    const db = base()
    const txn = db.transaction((a: string) => { db.prepare('INSERT INTO t (a) VALUES (?)').run(a) })
    txn('una'); txn('otra')
    expect(db.prepare('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 2 })
  })

  it('tres niveles de anidado confirman todo', () => {
    const db = base()
    const hoja = db.transaction(() => { db.prepare('INSERT INTO t (a) VALUES (?)').run('hoja') })
    const media = db.transaction(() => {
      db.prepare('INSERT INTO t (a) VALUES (?)').run('media')
      hoja()
    })
    db.transaction(() => { media() })()
    expect(db.prepare('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 2 })
  })
})

describe('close', () => {
  it('cierra la base', () => {
    const db = base()
    db.close()
    expect(() => db.prepare('SELECT 1').get()).toThrow()
  })
})
