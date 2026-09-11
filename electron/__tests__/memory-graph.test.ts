// Puente de datos del grafo navegable de memorias — ver electron/memory-graph.ts y
// .superpowers/sdd/2026-09-09-migracion-tailwind-shadcn/grafo-datos-brief.md.
//
// Tabla `observations` armada a mano (subset de columnas de BASE_SCHEMA en
// memory-store.ts) para testear la consulta pura sin pasar por MemoryStore ni por las
// reglas de negocio de save()/memory-merge.ts. Algunos fixtures (p.ej. tres filas vivas
// compartiendo topic_key) violarían el índice único `idx_obs_topic` de producción — a
// propósito: esta tabla no lo declara, porque lo que se testea es la lógica de la consulta
// sobre lo que sea que existe en la tabla, no si production podría llegar a ese estado.
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
      git_branch     TEXT,
      origin_ai      TEXT,
      author_display TEXT,
      updated_at     INTEGER NOT NULL,
      deleted        INTEGER NOT NULL DEFAULT 0,
      superseded_by  TEXT
    );

    -- buildMemoryGraph hace LEFT JOIN con \`projects\` para traer el nombre legible: el
    -- \`project_key\` es un hash, y sin esto la UI muestra "78b30bb38a968148" en vez del
    -- nombre del repo. El fixture tiene que tener la tabla aunque la mayoria de los casos
    -- no la use — el LEFT es lo que hace que una memoria de un proyecto no registrado siga
    -- apareciendo.
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
      (sync_id, project_key, scope, topic_key, type, title, git_branch, origin_ai,
       author_display, updated_at, deleted, superseded_by)
     VALUES (@sync_id, @project_key, @scope, @topic_key, @type, @title, @git_branch,
       @origin_ai, @author_display, @updated_at, @deleted, @superseded_by)`
  ).run({
    sync_id: r.syncId,
    project_key: r.projectKey ?? 'proj-a',
    scope: r.scope ?? 'personal',
    topic_key: r.topicKey ?? null,
    type: r.type ?? 'decision',
    title: r.title ?? r.syncId,
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

describe('buildMemoryGraph', () => {
  it('una cadena de superseded_by de 3 observaciones da 2 aristas revision dirigidas, viejo -> nuevo', () => {
    insert({ syncId: 'a', updatedAt: 100, supersededBy: 'b' })
    insert({ syncId: 'b', updatedAt: 200, supersededBy: 'c' })
    insert({ syncId: 'c', updatedAt: 300 })

    const graph = buildMemoryGraph(db, Q({ includeSuperseded: true }))

    const revisionEdges = graph.edges.filter((e) => e.kind === 'revision')
    expect(revisionEdges).toHaveLength(2)
    expect(revisionEdges).toContainEqual({ from: 'a', to: 'b', kind: 'revision', directed: true })
    expect(revisionEdges).toContainEqual({ from: 'b', to: 'c', kind: 'revision', directed: true })
  })

  it('con includeSuperseded: false las reemplazadas no son nodos y no quedan aristas colgantes', () => {
    insert({ syncId: 'a', updatedAt: 100, supersededBy: 'b' })
    insert({ syncId: 'b', updatedAt: 200 })

    const graph = buildMemoryGraph(db, Q())

    expect(graph.nodes.map((n) => n.syncId)).toEqual(['b'])
    expect(graph.edges.filter((e) => e.kind === 'revision')).toHaveLength(0)
  })

  it('tres observaciones con el mismo topic_key dan 2 aristas topic (cadena), no 3 (clique)', () => {
    insert({ syncId: 'a', topicKey: 'onboarding', updatedAt: 100 })
    insert({ syncId: 'b', topicKey: 'onboarding', updatedAt: 200 })
    insert({ syncId: 'c', topicKey: 'onboarding', updatedAt: 300 })

    const graph = buildMemoryGraph(db, Q())

    const topicEdges = graph.edges.filter((e) => e.kind === 'topic')
    expect(topicEdges).toHaveLength(2)
    expect(topicEdges).toContainEqual({ from: 'a', to: 'b', kind: 'topic', directed: false })
    expect(topicEdges).toContainEqual({ from: 'b', to: 'c', kind: 'topic', directed: false })
  })

  it('topic_key compartido entre proyectos o scopes distintos no conecta (misma project_key + scope)', () => {
    insert({ syncId: 'a', projectKey: 'proj-a', scope: 'personal', topicKey: 'x', updatedAt: 100 })
    insert({ syncId: 'b', projectKey: 'proj-b', scope: 'personal', topicKey: 'x', updatedAt: 200 })
    insert({ syncId: 'c', projectKey: 'proj-a', scope: 'team', topicKey: 'x', updatedAt: 300 })

    const graph = buildMemoryGraph(db, Q())

    expect(graph.edges.filter((e) => e.kind === 'topic')).toHaveLength(0)
  })

  it('deleted = 1 no aparece ni como nodo ni como extremo de una arista', () => {
    insert({ syncId: 'a', updatedAt: 100, deleted: 1, supersededBy: 'b' })
    insert({ syncId: 'b', updatedAt: 200 })

    const graph = buildMemoryGraph(db, Q({ includeSuperseded: true }))

    expect(graph.nodes.map((n) => n.syncId)).toEqual(['b'])
    expect(graph.edges).toHaveLength(0)
  })

  it('con limit menor a la cantidad de filas, truncated reporta el numero exacto y quedan las mas recientes', () => {
    insert({ syncId: 'old', updatedAt: 100 })
    insert({ syncId: 'mid', updatedAt: 200 })
    insert({ syncId: 'new', updatedAt: 300 })

    const graph = buildMemoryGraph(db, Q({ limit: 2 }))

    expect(graph.truncated).toBe(1)
    expect(graph.nodes.map((n) => n.syncId).sort()).toEqual(['mid', 'new'])
  })

  it('un git_branch null no genera aristas branch', () => {
    insert({ syncId: 'a', updatedAt: 100, gitBranch: null })
    insert({ syncId: 'b', updatedAt: 200, gitBranch: null })

    const graph = buildMemoryGraph(db, Q())

    expect(graph.edges.filter((e) => e.kind === 'branch')).toHaveLength(0)
  })

  it('git_branch compartido da una cadena de aristas branch, no un clique', () => {
    insert({ syncId: 'a', gitBranch: 'feat/x', updatedAt: 100 })
    insert({ syncId: 'b', gitBranch: 'feat/x', updatedAt: 300 })
    insert({ syncId: 'c', gitBranch: 'feat/x', updatedAt: 200 })

    const graph = buildMemoryGraph(db, Q())

    const branchEdges = graph.edges.filter((e) => e.kind === 'branch')
    expect(branchEdges).toHaveLength(2)
    // orden por updated_at: a(100) -> c(200) -> b(300)
    expect(branchEdges).toContainEqual({ from: 'a', to: 'c', kind: 'branch', directed: false })
    expect(branchEdges).toContainEqual({ from: 'c', to: 'b', kind: 'branch', directed: false })
  })

  it('un mismo nombre de git_branch en proyectos distintos no conecta (decision de diseno: branch escopeado por project_key)', () => {
    insert({ syncId: 'a', projectKey: 'proj-a', gitBranch: 'main', updatedAt: 100 })
    insert({ syncId: 'b', projectKey: 'proj-b', gitBranch: 'main', updatedAt: 200 })

    const graph = buildMemoryGraph(db, Q())

    expect(graph.edges.filter((e) => e.kind === 'branch')).toHaveLength(0)
  })

  it('projectKey filtra por proyecto', () => {
    insert({ syncId: 'a', projectKey: 'proj-a', updatedAt: 100 })
    insert({ syncId: 'b', projectKey: 'proj-b', updatedAt: 200 })

    const graph = buildMemoryGraph(db, Q({ projectKey: 'proj-a' }))

    expect(graph.nodes.map((n) => n.syncId)).toEqual(['a'])
  })

  it('sin filas, devuelve un grafo vacio con truncated 0', () => {
    const graph = buildMemoryGraph(db, Q())
    expect(graph).toEqual({ nodes: [], edges: [], truncated: 0 })
  })
})

describe('el nombre legible del proyecto', () => {
  // El bug que aparecio con datos reales: la UI agrupaba por proyecto y mostraba el
  // `project_key`, que es un hash (resolveProjectKey). El usuario veia
  // "78b30bb38a968148" donde esperaba el nombre de su repo.
  it('viene del join con projects', () => {
    db.prepare("INSERT INTO projects (project_key, display_name) VALUES ('78b30bb', 'raven-nest')").run()
    insert({ syncId: 'a', projectKey: '78b30bb' })

    const g = buildMemoryGraph(db, Q())
    expect(g.nodes[0].projectDisplayName).toBe('raven-nest')
  })

  // El LEFT del JOIN importa: una memoria puede referirse a un proyecto que nunca paso por
  // ensureProject(). Con un INNER JOIN esa memoria DESAPARECERIA del grafo en silencio.
  it('un proyecto no registrado deja el nombre en null pero la memoria sigue en el grafo', () => {
    insert({ syncId: 'a', projectKey: 'nunca-registrado' })

    const g = buildMemoryGraph(db, Q())
    expect(g.nodes).toHaveLength(1)
    expect(g.nodes[0].projectDisplayName).toBeNull()
  })
})
