// Vecinos de una memoria — lo que convierte la recuperación en CAMINAR el grafo en vez de
// volver a buscar. Ver electron/memory-vecinos.ts.
//
// Fixture a mano (subset de BASE_SCHEMA) con la tabla FTS y su trigger de INSERT, porque
// la dirección ENTRANTE —el backlink— se resuelve angostando con FTS5 y confirmando con el
// parser. Sin la tabla virtual el test no probaría el camino real.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { vecinosDeMemoria } from '../memory-vecinos'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE observations (
      sync_id       TEXT PRIMARY KEY,
      project_key   TEXT NOT NULL,
      scope         TEXT NOT NULL DEFAULT 'personal',
      topic_key     TEXT,
      title         TEXT NOT NULL,
      content       TEXT,
      tags          TEXT,
      deleted       INTEGER NOT NULL DEFAULT 0,
      superseded_by TEXT
    );
    CREATE VIRTUAL TABLE observations_fts USING fts5(
      title, content, tags, content='observations', content_rowid='rowid', tokenize='unicode61'
    );
    CREATE TRIGGER observations_ai AFTER INSERT ON observations BEGIN
      INSERT INTO observations_fts(rowid, title, content, tags)
      VALUES (new.rowid, new.title, new.content, coalesce(new.tags, ''));
    END;
    CREATE TABLE memory_links (
      a TEXT NOT NULL, b TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL,
      PRIMARY KEY (a, b)
    );
  `)
})

afterEach(() => db.close())

function insert(r: { syncId: string; title?: string; content?: string; topicKey?: string | null; deleted?: number; projectKey?: string }) {
  db.prepare(
    `INSERT INTO observations (sync_id, project_key, topic_key, title, content, deleted)
     VALUES (@sync_id, @project_key, @topic_key, @title, @content, @deleted)`
  ).run({
    sync_id: r.syncId,
    project_key: r.projectKey ?? 'proj-a',
    topic_key: r.topicKey ?? null,
    title: r.title ?? r.syncId,
    content: r.content ?? '',
    deleted: r.deleted ?? 0,
  })
}

describe('vecinosDeMemoria', () => {
  it('devuelve lo que ESTA memoria menciona, como saliente', () => {
    insert({ syncId: 'a', title: 'El candado de sync' })
    insert({ syncId: 'b', title: 'Otra', content: 'esto sale de [[El candado de sync]]' })

    expect(vecinosDeMemoria(db, 'b')).toEqual([
      { syncId: 'a', title: 'El candado de sync', topicKey: null, direction: 'outgoing', via: 'wikilink' },
    ])
  })

  it('devuelve el BACKLINK: quién menciona a esta memoria', () => {
    // Es la mitad cara y la que más sirve: "¿qué escribí que dependa de esto?"
    insert({ syncId: 'a', title: 'El candado de sync' })
    insert({ syncId: 'b', title: 'Otra', content: 'esto sale de [[El candado de sync]]' })

    expect(vecinosDeMemoria(db, 'a')).toEqual([
      { syncId: 'b', title: 'Otra', topicKey: null, direction: 'incoming', via: 'wikilink' },
    ])
  })

  it('resuelve por topic_key en las dos direcciones', () => {
    insert({ syncId: 'a', title: 'cualquiera', topicKey: 'arquitectura/candado' })
    insert({ syncId: 'b', title: 'Otra', content: 'ver [[arquitectura/candado]]' })

    expect(vecinosDeMemoria(db, 'b')[0]).toMatchObject({ syncId: 'a', direction: 'outgoing' })
    expect(vecinosDeMemoria(db, 'a')[0]).toMatchObject({ syncId: 'b', direction: 'incoming' })
  })

  it('una memoria que se menciona a sí misma no es su propia vecina', () => {
    insert({ syncId: 'a', title: 'yo mismo', content: 'soy [[yo mismo]]' })
    expect(vecinosDeMemoria(db, 'a')).toEqual([])
  })

  it('mencionar dos veces da UN solo vecino', () => {
    insert({ syncId: 'a', title: 'una' })
    insert({ syncId: 'b', content: '[[una]] y más abajo otra vez [[una]]' })
    expect(vecinosDeMemoria(db, 'b')).toHaveLength(1)
  })

  it('no devuelve memorias borradas, ni en salientes ni en entrantes', () => {
    insert({ syncId: 'a', title: 'borrada', deleted: 1 })
    insert({ syncId: 'b', title: 'viva', content: 'menciona [[borrada]]' })
    insert({ syncId: 'c', title: 'otra borrada', content: 'menciona [[viva]]', deleted: 1 })

    expect(vecinosDeMemoria(db, 'b')).toEqual([])
    expect(vecinosDeMemoria(db, 'a')).toEqual([])
  })

  it('incluye los links puestos a mano, marcados como tales y sin sentido', () => {
    insert({ syncId: 'a', title: 'una' })
    insert({ syncId: 'b', title: 'otra' })
    db.prepare('INSERT INTO memory_links (a, b, note, created_at) VALUES (?,?,?,?)').run('a', 'b', null, 1)

    expect(vecinosDeMemoria(db, 'a')).toEqual([
      { syncId: 'b', title: 'otra', topicKey: null, direction: 'both', via: 'manual' },
    ])
    expect(vecinosDeMemoria(db, 'b')[0]).toMatchObject({ syncId: 'a', via: 'manual' })
  })

  it('si el mismo vecino está por link escrito y a mano, no se lista dos veces', () => {
    insert({ syncId: 'a', title: 'una' })
    insert({ syncId: 'b', title: 'otra', content: 'ver [[una]]' })
    db.prepare('INSERT INTO memory_links (a, b, note, created_at) VALUES (?,?,?,?)').run('a', 'b', null, 1)

    const v = vecinosDeMemoria(db, 'b')
    expect(v).toHaveLength(1)
    // Gana el escrito: dice ADEMÁS para qué lado va, que es información que el manual no tiene.
    expect(v[0]).toMatchObject({ via: 'wikilink', direction: 'outgoing' })
  })

  it('la sintaxis de bash no inventa vecinos', () => {
    insert({ syncId: 'a', title: '-n "$x"' })
    insert({ syncId: 'b', content: '```bash\nif [[ -n "$x" ]]; then :; fi\n```' })
    expect(vecinosDeMemoria(db, 'b')).toEqual([])
  })

  it('un id que no existe devuelve vacío, no explota', () => {
    expect(vecinosDeMemoria(db, 'no-existe')).toEqual([])
  })

  it('no cruza proyectos', () => {
    insert({ syncId: 'a', title: 'una', projectKey: 'uno' })
    insert({ syncId: 'b', content: 'ver [[una]]', projectKey: 'dos' })
    expect(vecinosDeMemoria(db, 'b')).toEqual([])
  })

  it('el orden es estable entre llamadas', () => {
    insert({ syncId: 'z', title: 'zeta' })
    insert({ syncId: 'm', title: 'eme' })
    insert({ syncId: 'b', content: 'ver [[zeta]] y [[eme]]' })
    expect(vecinosDeMemoria(db, 'b').map(v => v.syncId)).toEqual(vecinosDeMemoria(db, 'b').map(v => v.syncId))
    expect(vecinosDeMemoria(db, 'b').map(v => v.syncId)).toEqual(['m', 'z'])
  })
})

import { linksPendientesDe } from '../memory-vecinos'

describe('linksPendientesDe', () => {
  it('devuelve el nombre de lo que esta memoria menciona y todavía no existe', () => {
    insert({ syncId: 'b', content: 'esto viene de [[algo que no escribí]]' })
    expect(linksPendientesDe(db, 'b')).toEqual(['algo que no escribí'])
  })

  it('no devuelve los que sí resuelven', () => {
    insert({ syncId: 'a', title: 'existe' })
    insert({ syncId: 'b', content: '[[existe]] y [[no existe]]' })
    expect(linksPendientesDe(db, 'b')).toEqual(['no existe'])
  })

  it('un link a una memoria borrada queda pendiente', () => {
    // Para resolver, una memoria borrada no existe. El link vuelve a ser un hueco — que es
    // exactamente lo que pasó: lo que apuntaba ya no está.
    insert({ syncId: 'a', title: 'se fue', deleted: 1 })
    insert({ syncId: 'b', content: 'ver [[se fue]]' })
    expect(linksPendientesDe(db, 'b')).toEqual(['se fue'])
  })

  it('no repite el mismo nombre', () => {
    insert({ syncId: 'b', content: '[[falta]] y otra vez [[falta]]' })
    expect(linksPendientesDe(db, 'b')).toEqual(['falta'])
  })

  it('la sintaxis de bash no cuenta como pendiente', () => {
    insert({ syncId: 'b', content: '```bash\nif [[ -n "$x" ]]; then :; fi\n```' })
    expect(linksPendientesDe(db, 'b')).toEqual([])
  })

  it('un id que no existe devuelve vacío', () => {
    expect(linksPendientesDe(db, 'no-existe')).toEqual([])
  })
})
