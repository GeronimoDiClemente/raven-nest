// Arista `similar` de electron/memory-graph.ts — cuarto tipo de arista, opt-in via
// query.includeSimilar (default false). Archivo separado de memory-graph.test.ts a
// propósito: los 11 tests de ese archivo no se tocan (contrato de la tarea), y esta tabla
// necesita una columna `tags` que ese fixture no declara.
//
// Mismo patrón que memory-graph.test.ts: tabla `observations` armada a mano (subset de
// BASE_SCHEMA de memory-store.ts) para testear la consulta pura sin pasar por MemoryStore.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { buildMemoryGraph, type MemoryGraphQuery } from '../memory-graph'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE observations (
      sync_id        TEXT PRIMARY KEY,
      project_key    TEXT NOT NULL,
      scope          TEXT NOT NULL,
      topic_key      TEXT,
      type           TEXT NOT NULL,
      title          TEXT NOT NULL,
      tags           TEXT,
      git_branch     TEXT,
      origin_ai      TEXT,
      author_display TEXT,
      updated_at     INTEGER NOT NULL,
      deleted        INTEGER NOT NULL DEFAULT 0,
      superseded_by  TEXT
    );

    -- buildMemoryGraph hace LEFT JOIN con \`projects\` por el nombre legible del proyecto
    -- (el \`project_key\` es un hash). El fixture necesita la tabla aunque estos casos no
    -- la usen.
    CREATE TABLE projects (
      project_key  TEXT PRIMARY KEY,
      display_name TEXT NOT NULL
    );
  `)
})

afterEach(() => {
  db.close()
})

interface Row {
  syncId: string
  projectKey?: string
  scope?: string
  topicKey?: string | null
  type?: string
  title?: string
  tags?: string[] | null
  gitBranch?: string | null
  originAi?: string | null
  authorDisplay?: string | null
  updatedAt?: number
  deleted?: number
  supersededBy?: string | null
}

function insert(r: Row): void {
  db.prepare(
    `INSERT INTO observations
      (sync_id, project_key, scope, topic_key, type, title, tags, git_branch, origin_ai,
       author_display, updated_at, deleted, superseded_by)
     VALUES (@sync_id, @project_key, @scope, @topic_key, @type, @title, @tags, @git_branch,
       @origin_ai, @author_display, @updated_at, @deleted, @superseded_by)`
  ).run({
    sync_id: r.syncId,
    project_key: r.projectKey ?? 'proj-a',
    scope: r.scope ?? 'personal',
    topic_key: r.topicKey ?? null,
    type: r.type ?? 'decision',
    title: r.title ?? r.syncId,
    tags: r.tags ? JSON.stringify(r.tags) : null,
    git_branch: r.gitBranch ?? null,
    origin_ai: r.originAi ?? null,
    author_display: r.authorDisplay ?? null,
    updated_at: r.updatedAt ?? 1000,
    deleted: r.deleted ?? 0,
    superseded_by: r.supersededBy ?? null,
  })
}

const Q = (overrides: Partial<MemoryGraphQuery> = {}): MemoryGraphQuery => ({
  projectKey: null,
  includeSuperseded: false,
  limit: 300,
  ...overrides,
})

function similarEdges(graph: ReturnType<typeof buildMemoryGraph>) {
  return graph.edges.filter((e) => e.kind === 'similar')
}

describe('buildMemoryGraph — arista similar', () => {
  it('con includeSimilar apagado (default) no emite ninguna arista similar, ni con tags identicos', () => {
    insert({ syncId: 'a', tags: ['bug', 'ui'], updatedAt: 100 })
    insert({ syncId: 'b', tags: ['bug', 'ui'], updatedAt: 200 })

    const graph = buildMemoryGraph(db, Q())

    expect(similarEdges(graph)).toHaveLength(0)
  })

  it('dos observaciones con tags en comun y el flag prendido dan una arista similar no dirigida', () => {
    insert({ syncId: 'a', tags: ['onboarding-flow'], updatedAt: 100 })
    insert({ syncId: 'b', tags: ['onboarding-flow'], updatedAt: 200 })

    const graph = buildMemoryGraph(db, Q({ includeSimilar: true }))

    const edges = similarEdges(graph)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ kind: 'similar', directed: false })
    expect([edges[0].from, edges[0].to].sort()).toEqual(['a', 'b'])
  })

  it('dos observaciones sin ningun tag en comun no producen arista similar', () => {
    insert({ syncId: 'a', tags: ['alpha'], updatedAt: 100 })
    insert({ syncId: 'b', tags: ['beta'], updatedAt: 200 })

    const graph = buildMemoryGraph(db, Q({ includeSimilar: true }))

    expect(similarEdges(graph)).toHaveLength(0)
  })

  it('el tope por nodo se respeta: con muchos vecinos parecidos, ninguno supera K', () => {
    // hub + 4 leaves comparten 'shared' (todas se emparejan entre si a score 1.0: es el
    // unico tag de cada una). 5 fillers con tags unicos, sin relacion con nadie, estan solo
    // para que 'shared' (df=5) no supere el 50% del corpus tageado (n=10) y no se pise a 0
    // por la regla de "tag popular" (ver test dedicado a esa regla, mas abajo). Sin tope,
    // el hub tendria 4 aristas similar (una por cada leaf).
    insert({ syncId: 'hub', tags: ['shared'], updatedAt: 1000 })
    for (let i = 0; i < 4; i++) {
      insert({ syncId: `leaf-${i}`, tags: ['shared'], updatedAt: 100 + i })
    }
    for (let i = 0; i < 5; i++) {
      insert({ syncId: `filler-${i}`, tags: [`unique-${i}`], updatedAt: 200 + i })
    }

    const graph = buildMemoryGraph(db, Q({ includeSimilar: true, similarMaxPerNode: 2 }))

    const edges = similarEdges(graph)
    expect(edges.length).toBeGreaterThan(0)
    const perNode = new Map<string, number>()
    for (const e of edges) {
      perNode.set(e.from, (perNode.get(e.from) ?? 0) + 1)
      perNode.set(e.to, (perNode.get(e.to) ?? 0) + 1)
    }
    for (const count of perNode.values()) {
      expect(count).toBeLessThanOrEqual(2)
    }
    // el hub tenia 4 candidatos por encima del tope de 2: se queda justo en el tope.
    expect(perNode.get('hub')).toBe(2)
  })

  it('un tag presente en casi todo el corpus no genera la explosion de aristas', () => {
    // 9 de 10 observaciones comparten el tag "bug" (>50% del corpus tageado) y NADA MAS en
    // comun entre si -> weight('bug') se pisa a 0 por POPULAR_TAG_RATIO, union = interseccion
    // = 0, score 0, ninguna arista. La decima tiene un tag distinto para no ser trivial.
    for (let i = 0; i < 9; i++) {
      insert({ syncId: `bug-${i}`, tags: ['bug'], updatedAt: 100 + i })
    }
    insert({ syncId: 'other', tags: ['unrelated'], updatedAt: 500 })

    const graph = buildMemoryGraph(db, Q({ includeSimilar: true }))

    expect(similarEdges(graph)).toHaveLength(0)
  })

  it('si A y B ya estan unidos por revision, no aparece ademas una similar entre ellos', () => {
    insert({ syncId: 'a', tags: ['onboarding-flow'], updatedAt: 100, supersededBy: 'b' })
    insert({ syncId: 'b', tags: ['onboarding-flow'], updatedAt: 200 })

    const graph = buildMemoryGraph(db, Q({ includeSuperseded: true, includeSimilar: true }))

    expect(graph.edges.filter((e) => e.kind === 'revision')).toHaveLength(1)
    expect(similarEdges(graph)).toHaveLength(0)
  })
})
