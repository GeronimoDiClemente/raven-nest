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
      superseded_by  TEXT,
      source_ref     TEXT,
      tags           TEXT
    );

    -- buildMemoryGraph lee las relaciones puestas a mano de su propia tabla: topic_key no
    -- sirve para eso porque es UNICO por (project, scope, topic) entre las filas vivas, asi
    -- que dos memorias del mismo proyecto no pueden compartir tema.
    CREATE TABLE memory_links (
      a          TEXT NOT NULL,
      b          TEXT NOT NULL,
      note       TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (a, b)
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
  sourceRef?: string | null
  tags?: string[] | null
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
       author_display, updated_at, deleted, superseded_by, source_ref, tags)
     VALUES (@sync_id, @project_key, @scope, @topic_key, @type, @title, @git_branch,
       @origin_ai, @author_display, @updated_at, @deleted, @superseded_by, @source_ref, @tags)`
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
    source_ref: r.sourceRef ?? null,
    tags: r.tags ? JSON.stringify(r.tags) : null,
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

// La arista que faltaba. Una memoria IMPORTADA no podia conectarse con ninguna otra por
// construccion: el importador de Markdown le da a cada chunk su propio topic_key (derivado
// de su heading, asi que nunca se repite) y no le pone git_branch, ni tags, ni
// superseded_by. Medido en una cuenta real: ~200 memorias, CERO aristas.
describe('arista source — mismo documento de origen', () => {
  it('dos secciones del mismo archivo quedan conectadas', () => {
    insert({ syncId: 'a', sourceRef: 'claude-md:/repo/CLAUDE.md#uno', updatedAt: 1 })
    insert({ syncId: 'b', sourceRef: 'claude-md:/repo/CLAUDE.md#dos', updatedAt: 2 })

    const g = buildMemoryGraph(db, Q())
    const source = g.edges.filter((e) => e.kind === 'source')
    expect(source).toHaveLength(1)
    expect(source[0].directed).toBe(false)
  })

  it('archivos distintos no se conectan', () => {
    insert({ syncId: 'a', sourceRef: 'claude-md:/repo/CLAUDE.md#uno', updatedAt: 1 })
    insert({ syncId: 'b', sourceRef: 'claude-md:/repo/OTRO.md#uno', updatedAt: 2 })

    expect(buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'source')).toHaveLength(0)
  })

  // Escopeada por proyecto, igual que branch: dos repos con un CLAUDE.md cada uno no son el
  // mismo documento aunque el path relativo coincida.
  it('el mismo path en dos proyectos distintos no conecta', () => {
    insert({ syncId: 'a', projectKey: 'uno', sourceRef: 'claude-md:/CLAUDE.md#x', updatedAt: 1 })
    insert({ syncId: 'b', projectKey: 'dos', sourceRef: 'claude-md:/CLAUDE.md#y', updatedAt: 2 })

    expect(buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'source')).toHaveLength(0)
  })

  it('sin source_ref no genera aristas', () => {
    insert({ syncId: 'a', updatedAt: 1 })
    insert({ syncId: 'b', updatedAt: 2 })

    expect(buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'source')).toHaveLength(0)
  })

  // Cadena, no clique: un CLAUDE.md de 60 secciones daria 1770 aristas en clique y el grafo
  // se volveria una bola negra.
  it('tres secciones del mismo archivo dan DOS aristas, no tres', () => {
    insert({ syncId: 'a', sourceRef: 'md:/f.md#1', updatedAt: 1 })
    insert({ syncId: 'b', sourceRef: 'md:/f.md#2', updatedAt: 2 })
    insert({ syncId: 'c', sourceRef: 'md:/f.md#3', updatedAt: 3 })

    expect(buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'source')).toHaveLength(2)
  })
})

// La unica arista de HECHO que cruza proyectos. Las otras tres estan escopeadas por
// proyecto con razon (dos repos con una rama `main` no comparten nada, un CLAUDE.md en cada
// uno no es el mismo documento), pero un topic_key SI es una decision deliberada: si "auth"
// aparece en dos repos, hay trabajo sobre el mismo tema en los dos lados.
// La hermana de cross-topic, y la que de verdad hace real "trabajo en conjunto entre
// repos". El `topic_key` lo elige el agente al guardar y casi nunca coincide entre dos
// repos: en la prueba del shim, tres memorias con el tag `auth` en dos proyectos dieron
// topics distintos y la del segundo repo quedo "sin conectar con ninguna otra". El tag si
// coincide, porque etiqueta a QUE es el trabajo y no que memoria puntual es.
describe('arista cross-tag — el mismo tag en otro repo', () => {
  it('une dos proyectos que comparten tag aunque los topics sean distintos', () => {
    insert({ syncId: 'a', projectKey: 'uno', topicKey: 'auth-cookies', tags: ['auth'], updatedAt: 1 })
    insert({ syncId: 'b', projectKey: 'dos', topicKey: 'auth-samesite', tags: ['auth'], updatedAt: 2 })

    const cross = buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'cross-tag')
    expect(cross).toHaveLength(1)
    expect(cross[0].directed).toBe(false)
  })

  it('dentro del mismo proyecto no emite nada: eso ya lo dice `topic` o `similar`', () => {
    insert({ syncId: 'a', projectKey: 'uno', tags: ['auth'], updatedAt: 1 })
    insert({ syncId: 'b', projectKey: 'uno', tags: ['auth'], updatedAt: 2 })

    expect(buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'cross-tag')).toHaveLength(0)
  })

  it('tags distintos no se unen', () => {
    insert({ syncId: 'a', projectKey: 'uno', tags: ['auth'], updatedAt: 1 })
    insert({ syncId: 'b', projectKey: 'dos', tags: ['pagos'], updatedAt: 2 })

    expect(buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'cross-tag')).toHaveLength(0)
  })

  // Mismo criterio que cross-topic: un representante por proyecto y cadena, o un tag popular
  // en 4 repos taparia el grafo entero.
  it('con varias memorias por proyecto, une representantes: 3 repos dan 2 aristas', () => {
    for (const p of ['uno', 'dos', 'tres']) {
      for (let i = 0; i < 3; i++) {
        insert({ syncId: `${p}-${i}`, projectKey: p, tags: ['auth'], updatedAt: i + 1 })
      }
    }

    expect(buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'cross-tag')).toHaveLength(2)
  })

  // Cuando dos memorias comparten topic Y tag, la de topic es la afirmacion mas fuerte y es
  // la que se dibuja. Sin este dedup se dibujarian dos lineas entre el mismo par de nodos.
  it('no duplica cuando ya hay una cross-topic entre el mismo par', () => {
    insert({ syncId: 'a', projectKey: 'uno', topicKey: 'auth', tags: ['auth'], updatedAt: 1 })
    insert({ syncId: 'b', projectKey: 'dos', topicKey: 'auth', tags: ['auth'], updatedAt: 2 })

    const g = buildMemoryGraph(db, Q())
    expect(g.edges.filter((e) => e.kind === 'cross-topic')).toHaveLength(1)
    expect(g.edges.filter((e) => e.kind === 'cross-tag')).toHaveLength(0)
  })

  // Una memoria con varios tags entra en varios grupos. Entre el MISMO par de repos eso da
  // una sola arista, no una por tag compartido.
  it('dos tags compartidos entre los mismos dos repos dan una arista, no dos', () => {
    insert({ syncId: 'a', projectKey: 'uno', tags: ['auth', 'api'], updatedAt: 1 })
    insert({ syncId: 'b', projectKey: 'dos', tags: ['auth', 'api'], updatedAt: 2 })

    expect(buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'cross-tag')).toHaveLength(1)
  })
})

describe('arista cross-topic — el mismo tema en otro repo', () => {
  it('une dos proyectos que comparten topic_key', () => {
    insert({ syncId: 'a', projectKey: 'uno', topicKey: 'auth', updatedAt: 1 })
    insert({ syncId: 'b', projectKey: 'dos', topicKey: 'auth', updatedAt: 2 })

    const cross = buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'cross-topic')
    expect(cross).toHaveLength(1)
    expect(cross[0].directed).toBe(false)
  })

  it('dentro del MISMO proyecto no emite cross-topic: para eso esta `topic`', () => {
    insert({ syncId: 'a', projectKey: 'uno', topicKey: 'auth', updatedAt: 1 })
    insert({ syncId: 'b', projectKey: 'uno', topicKey: 'auth', updatedAt: 2 })

    const g = buildMemoryGraph(db, Q())
    expect(g.edges.filter((e) => e.kind === 'cross-topic')).toHaveLength(0)
    expect(g.edges.filter((e) => e.kind === 'topic')).toHaveLength(1)
  })

  it('topics distintos no se unen aunque sean de proyectos distintos', () => {
    insert({ syncId: 'a', projectKey: 'uno', topicKey: 'auth', updatedAt: 1 })
    insert({ syncId: 'b', projectKey: 'dos', topicKey: 'pagos', updatedAt: 2 })

    expect(buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'cross-topic')).toHaveLength(0)
  })

  // UN representante por proyecto, y despues cadena. Todos contra todos taparia el grafo:
  // un topic compartido por 4 repos con 10 memorias cada uno daria 600 aristas.
  it('con varias memorias por proyecto, une representantes: 3 repos dan 2 aristas', () => {
    for (const [p, n] of [['uno', 3], ['dos', 3], ['tres', 3]] as const) {
      for (let i = 0; i < n; i++) {
        insert({ syncId: `${p}-${i}`, projectKey: p, topicKey: 'auth', updatedAt: i + 1 })
      }
    }

    expect(buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'cross-topic')).toHaveLength(2)
  })

  it('el representante de cada proyecto es el mas reciente', () => {
    insert({ syncId: 'viejo', projectKey: 'uno', topicKey: 'auth', updatedAt: 1 })
    insert({ syncId: 'nuevo', projectKey: 'uno', topicKey: 'auth', updatedAt: 9 })
    insert({ syncId: 'otro', projectKey: 'dos', topicKey: 'auth', updatedAt: 5 })

    const cross = buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'cross-topic')
    expect(cross).toHaveLength(1)
    expect([cross[0].from, cross[0].to].sort()).toEqual(['nuevo', 'otro'])
  })

  // Un scope distinto no es el mismo tema: `personal` y `team` se llevan aparte en toda la
  // capa de datos, y mezclarlos aca filtraria memorias personales a un hilo de equipo.
  it('el mismo topic en scopes distintos no cruza', () => {
    insert({ syncId: 'a', projectKey: 'uno', scope: 'personal', topicKey: 'auth', updatedAt: 1 })
    insert({ syncId: 'b', projectKey: 'dos', scope: 'team', topicKey: 'auth', updatedAt: 2 })

    expect(buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'cross-topic')).toHaveLength(0)
  })
})

// La unica relacion que una PERSONA afirma. Las otras seis las infiere el sistema de algun
// campo compartido, y por eso esta se guarda aparte y se dibuja mas marcada.
describe('arista manual — conectada a mano', () => {
  function conectar(a: string, b: string) {
    const [x, y] = a < b ? [a, b] : [b, a]
    db.prepare('INSERT OR REPLACE INTO memory_links (a, b, note, created_at) VALUES (?,?,?,?)')
      .run(x, y, null, 1)
  }

  it('une dos memorias que no comparten nada mas', () => {
    insert({ syncId: 'a', projectKey: 'uno', updatedAt: 1 })
    insert({ syncId: 'b', projectKey: 'dos', updatedAt: 2 })
    conectar('a', 'b')

    const manual = buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'manual')
    expect(manual).toHaveLength(1)
    expect(manual[0].directed).toBe(false)
  })

  // Conectar A con B y despues B con A es la MISMA relacion. Sin ordenar los ids al
  // insertar, el grafo dibujaria dos lineas donde hay una.
  it('conectar en los dos sentidos da UNA sola arista', () => {
    insert({ syncId: 'a', updatedAt: 1 })
    insert({ syncId: 'b', updatedAt: 2 })
    conectar('a', 'b')
    conectar('b', 'a')

    expect(buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'manual')).toHaveLength(1)
  })

  // Una arista hacia un nodo que no vino haria aparecer un punto fantasma sin titulo ni
  // color — lo mismo que toGraphData filtra del lado del render.
  it('no emite la arista si una punta no esta en el grafo', () => {
    insert({ syncId: 'a', updatedAt: 1 })
    conectar('a', 'fantasma')

    expect(buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'manual')).toHaveLength(0)
  })

  // Cruza proyectos sin pedir permiso: si alguien dice que estas dos van juntas, van juntas,
  // vengan de donde vengan. Es la diferencia entre afirmar e inferir.
  it('cruza proyectos', () => {
    insert({ syncId: 'a', projectKey: 'uno', updatedAt: 1 })
    insert({ syncId: 'b', projectKey: 'dos', updatedAt: 2 })
    conectar('a', 'b')

    expect(buildMemoryGraph(db, Q()).edges.filter((e) => e.kind === 'manual')).toHaveLength(1)
  })
})
