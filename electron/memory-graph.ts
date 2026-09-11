// Puente de datos para el grafo navegable de memorias (estilo Obsidian). Ver
// .superpowers/sdd/2026-09-09-migracion-tailwind-shadcn/grafo-datos-brief.md.
//
// Función pura sobre una instancia de Database: no abre nada, no conoce Electron. Así se
// testea con una db en memoria sin pasar por MemoryStore.
//
// Hallazgo verificado contra el schema (memory-store.ts BASE_SCHEMA, idx_obs_topic): el
// índice único `ON observations(project_key, scope, topic_key) WHERE topic_key IS NOT NULL
// AND deleted = 0 AND superseded_by IS NULL` garantiza que, en datos reales, nunca hay dos
// filas VIVAS (no borradas, no reemplazadas) con el mismo topic_key dentro del mismo
// project_key + scope — `superseded_by` es justo la resolución de esa colisión
// (memory-merge.ts: resolveTopicCollision). O sea que en la práctica, con
// `includeSuperseded: false` (el default), casi nunca va a aparecer una arista `topic`: el
// topic_key compartido vive en la CADENA de revisiones, no entre dos nodos vivos a la vez.
// Esto no es un bug de esta consulta — es SEÑAL: es exactamente el motivo por el que
// `revision` (dirigida, del viejo al nuevo) es la arista más rica del grafo, y por qué
// `topic`/`branch` son agrupaciones sobre lo que el query realmente devolvió como nodos, no
// un filtro adicional de "vivo" por encima de eso. Por diseño, esta función agrupa
// topic/branch sobre el conjunto de nodos ya seleccionado (respetando `includeSuperseded` y
// `limit`), sin re-excluir superseded: así, cuando `includeSuperseded: true` trae de vuelta
// una cadena de colisión de topic, esa cadena SÍ puede aparecer también como aristas
// `topic` (redundante con `revision` en ese caso puntual, pero no incorrecto — son hechos
// distintos: una es supersesión explícita, la otra es una clasificación compartida).
//
// Cuarto tipo de arista, `similar`: precisamente porque `topic` casi no aparece, el grafo
// real es cadenas de linaje colgando de racimos por rama, sin cúmulos temáticos — que es lo
// que lo haría útil para navegar. `similar` (tags compartidos, ver computeSimilarEdges más
// abajo) es INFERENCIA sobre contenido, no un hecho declarado como las otras tres — por eso
// vive detrás de `query.includeSimilar`, apagado por default.
import type Database from 'better-sqlite3'

export type MemoryEdgeKind = 'revision' | 'topic' | 'branch' | 'source' | 'cross-topic' | 'similar'

export interface MemoryGraphNode {
  syncId: string
  /** De que proyecto viene. La consulta ya lo traia (se usa para escopear las aristas
   *  `topic` y `branch`), pero no salia del modulo — y sin el, la UI no puede agrupar por
   *  proyecto, que es como Obsidian hace legible un grafo grande. */
  projectKey: string
  /** El nombre legible del proyecto, o `null` si nunca pasó por `ensureProject()`. La UI
   *  cae a `projectKey` — que es un hash — sólo cuando esto falta. */
  projectDisplayName: string | null
  title: string
  type: string
  scope: 'personal' | 'project' | 'team'
  topicKey: string | null
  gitBranch: string | null
  originAi: string | null
  authorDisplay: string | null
  updatedAt: number
  /** true si esta observacion fue reemplazada por otra (superseded_by != null). */
  superseded: boolean
}

export interface MemoryGraphEdge {
  from: string
  to: string
  kind: MemoryEdgeKind
  /** true solo para 'revision'. Las otras dos son simetricas. */
  directed: boolean
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[]
  edges: MemoryGraphEdge[]
  /** cuantos nodos se dejaron afuera por el limite. */
  truncated: number
}

export interface MemoryGraphQuery {
  projectKey: string | null // null = todos los proyectos
  includeSuperseded: boolean // default false
  limit: number // default 300
  /** Arista `similar` (tags compartidos, ponderados). A diferencia de revision/topic/branch
   *  — hechos que alguien afirmo (una supersesion explicita, un topic_key, una rama) — esta
   *  es INFERENCIA sobre contenido. Optional + default false (no encaja con el comentario de
   *  arriba de "sin campos opcionales": ese diseño es para las tres aristas-hecho, que un
   *  caller siempre tiene que decidir; esta es aparte y opt-in). Ver computeSimilarEdges. */
  includeSimilar?: boolean
  /** Tope de aristas `similar` por nodo (los K vecinos mas parecidos, no todos). Default:
   *  DEFAULT_SIMILAR_MAX_PER_NODE. */
  similarMaxPerNode?: number
  /** Umbral minimo de score (Jaccard ponderado, 0..1) para emitir una arista `similar`.
   *  Default: DEFAULT_SIMILAR_MIN_SCORE. */
  similarMinScore?: number
}

/** K vecinos `similar` mas parecidos por nodo. 5: alcanza para navegar ("ver relacionados")
 *  sin que un tag popular convierta el grafo en un peloton negro de todos-contra-todos —
 *  ver el ejemplo de "bug" con 200 observaciones en el brief. */
const DEFAULT_SIMILAR_MAX_PER_NODE = 5

/** Piso de score (Jaccard ponderado, ver computeSimilarEdges) para emitir una arista
 *  `similar`. 0.3: exige que al menos ~un tercio del peso combinado de tags entre las dos
 *  observaciones este compartido — filtra el caso de una coincidencia debil y aislada
 *  entre dos bolsas de tags grandes y en su mayoria distintas, sin pedir identidad total. */
const DEFAULT_SIMILAR_MIN_SCORE = 0.3

/** Fraccion del corpus tageado por encima de la cual un tag se considera "popular" y su
 *  peso se pisa a 0 (no aporta ni a la interseccion ni a la union del Jaccard). Encodea
 *  literal el brief: "si un tag aparece en la mayoria de las observaciones, conectar por
 *  el no dice nada". Sin este corte duro, dos observaciones que SOLO comparten un tag
 *  casi-universal podrian dar Jaccard = 1 (interseccion == union) si no tienen ningun otro
 *  tag encima para diluir el ratio — un IDF suave no alcanza para ese caso limite, hace
 *  falta un piso explicito. 0.5 = "aparece en mas de la mitad" es la lectura mas directa de
 *  "la mayoria". */
const POPULAR_TAG_RATIO = 0.5

/** La regla de "tag popular" de arriba solo se aplica si el corpus tageado tiene al menos
 *  esta cantidad de observaciones. Por debajo, "aparece en la mayoria" no es una señal
 *  confiable: con 2 observaciones, CUALQUIER tag que compartan esta por definicion en el
 *  100% del corpus (df == n) — penalizarlo ahi adentro mataria el caso base de la funcion
 *  (dos memorias nuevas que comparten un tag especifico) antes de que exista suficiente
 *  data para distinguir "tag realmente ubicuo" de "todavia hay pocas observaciones". */
const MIN_CORPUS_FOR_POPULARITY = 5

interface GraphRow {
  sync_id: string
  project_key: string
  scope: string
  topic_key: string | null
  type: string
  title: string
  project_display_name: string | null
  git_branch: string | null
  source_ref: string | null
  origin_ai: string | null
  author_display: string | null
  updated_at: number
  superseded_by: string | null
}

/** Agrupa filas por `keyFn` y arma una cadena (n-1 aristas) ordenada por updated_at
 *  dentro de cada grupo de 2+ — nunca un clique. `sync_id` es el desempate determinístico
 *  para filas con el mismo updated_at. */
function chainEdges(rows: GraphRow[], kind: MemoryEdgeKind, keyFn: (r: GraphRow) => string | null): MemoryGraphEdge[] {
  const groups = new Map<string, GraphRow[]>()
  for (const r of rows) {
    const key = keyFn(r)
    if (key === null) continue
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }
  const edges: MemoryGraphEdge[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const ordered = [...group].sort(
      (a, b) => a.updated_at - b.updated_at || a.sync_id.localeCompare(b.sync_id)
    )
    for (let i = 0; i < ordered.length - 1; i++) {
      edges.push({ from: ordered[i].sync_id, to: ordered[i + 1].sync_id, kind, directed: false })
    }
  }
  return edges
}

/**
 * Aristas que CRUZAN proyectos: el mismo `topic_key` en dos repos distintos.
 *
 * Las otras tres aristas de hecho estan escopeadas por proyecto, y con razon: dos repos con
 * una rama `main` no comparten nada, y un `CLAUDE.md` en cada uno no es el mismo documento.
 * Pero un topic_key SI es una decision deliberada de quien lo puso — si "auth" aparece en
 * dos repos, eso es trabajo sobre el mismo tema en los dos lados, que es justo lo que un
 * grafo de varios proyectos tiene para aportar y hoy no aportaba.
 *
 * Un REPRESENTANTE por proyecto (el mas reciente), y despues cadena entre representantes.
 * No todos contra todos: un topic compartido por 4 repos con 10 memorias cada uno daria
 * 600 aristas en clique y taparia el grafo entero. Asi da 3.
 */
function crossProjectTopicEdges(rows: GraphRow[]): MemoryGraphEdge[] {
  const porTopic = new Map<string, GraphRow[]>()
  for (const r of rows) {
    if (!r.topic_key) continue
    const key = `${r.scope}\u0000${r.topic_key}`
    const lista = porTopic.get(key)
    if (lista) lista.push(r)
    else porTopic.set(key, [r])
  }

  const edges: MemoryGraphEdge[] = []
  for (const grupo of porTopic.values()) {
    // Un representante por proyecto: el mas reciente, con sync_id de desempate para que el
    // resultado no dependa del orden en que vinieron las filas.
    const representantes = new Map<string, GraphRow>()
    for (const r of grupo) {
      const actual = representantes.get(r.project_key)
      if (!actual
        || r.updated_at > actual.updated_at
        || (r.updated_at === actual.updated_at && r.sync_id < actual.sync_id)) {
        representantes.set(r.project_key, r)
      }
    }
    if (representantes.size < 2) continue

    const ordenados = [...representantes.values()].sort(
      (a, b) => a.project_key.localeCompare(b.project_key)
    )
    for (let i = 0; i < ordenados.length - 1; i++) {
      edges.push({
        from: ordenados[i].sync_id,
        to: ordenados[i + 1].sync_id,
        kind: 'cross-topic',
        directed: false,
      })
    }
  }
  return edges
}

/** Clave no dirigida para un par de nodos, para poder preguntar "¿ya hay una arista entre
 *  A y B, sin importar de que kind ni en que sentido?" con un Set. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}

/** La columna `tags` es TEXT con un array JSON serializado (ver memory-store.ts:
 *  `tags: input.tags ? JSON.stringify(input.tags) : null` en save(), y el parseo simétrico
 *  en toDoc(): `row.tags ? JSON.parse(row.tags) : []`). Null o JSON invalido -> sin tags. */
function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

/**
 * Arista `similar`: dos observaciones comparten tags. Empezamos por tags (no por FTS sobre
 * title/content) porque son la señal más barata y más explicable — "comparten estos 3
 * tags" se puede mostrar en la UI tal cual, mientras que un score de FTS no se le puede
 * explicar al usuario sin más contexto. Con esto el grafo deja de estar ralo para los casos
 * reales que motivan este ticket (memorias tageadas a mano o por el importer); si en la
 * práctica quedara demasiado ralo (corpus con pocos tags) el siguiente paso sería sumar
 * FTS5 sobre `observations_fts` como señal adicional — no se implementa acá, ver reporte.
 *
 * Score = Jaccard ponderado de los dos conjuntos de tags. Cada tag pesa:
 *   - 0 si es "popular" (aparece en más de POPULAR_TAG_RATIO del corpus tageado, y el
 *     corpus tiene al menos MIN_CORPUS_FOR_POPULARITY observaciones tageadas): un tag así
 *     no informa (brief), y un corte duro es necesario — un IDF suave sin piso todavía deja
 *     que dos observaciones con UN SOLO tag casi-universal en común den Jaccard 1.
 *   - log((n + 1) / df(tag)) en cualquier otro caso — un IDF con suavizado de Laplace
 *     (+1 en el numerador). Sin el +1, un tag presente en TODAS las observaciones tageadas
 *     (df === n) pesa log(n/n) = 0 — que es exactamente lo que buscamos para un tag
 *     realmente popular, pero también es el caso de dos observaciones sueltas que comparten
 *     su único tag (df === n === 2): sin corpus alrededor para diluir el ratio, ese tag
 *     "parece" popular por pura escasez de datos, no porque no informe. El +1 lo mantiene
 *     positivo salvo que la regla de arriba lo haya pisado a 0 a propósito.
 * El resultado (intersección-ponderada / unión-ponderada) siempre cae en [0,1] porque la
 * intersección es un subconjunto de la unión y los pesos son no-negativos.
 */
function computeSimilarEdges(
  db: Database.Database,
  selected: GraphRow[],
  existingPairs: Set<string>,
  maxPerNode: number,
  minScore: number
): MemoryGraphEdge[] {
  if (selected.length < 2) return []

  const syncIds = selected.map((r) => r.sync_id)
  // Consulta separada del SELECT principal de buildMemoryGraph: `tags` solo se lee cuando
  // includeSimilar está prendido, así un caller (o un fixture de test, ver
  // memory-graph.test.ts) que arma su propia tabla `observations` sin esa columna no se
  // rompe mientras no pida aristas `similar`.
  const placeholders = syncIds.map(() => '?').join(',')
  const tagRows = db
    .prepare(`SELECT sync_id, tags FROM observations WHERE sync_id IN (${placeholders})`)
    .all(...syncIds) as { sync_id: string; tags: string | null }[]

  const tagSets = new Map<string, Set<string>>()
  for (const row of tagRows) {
    const tags = parseTags(row.tags)
    if (tags.length > 0) tagSets.set(row.sync_id, new Set(tags))
  }

  const taggedIds = [...tagSets.keys()]
  if (taggedIds.length < 2) return []

  const n = taggedIds.length
  const df = new Map<string, number>()
  for (const tags of tagSets.values()) {
    for (const t of tags) df.set(t, (df.get(t) ?? 0) + 1)
  }
  const weight = new Map<string, number>()
  for (const [t, count] of df) {
    const popular = n >= MIN_CORPUS_FOR_POPULARITY && count / n > POPULAR_TAG_RATIO
    weight.set(t, popular ? 0 : Math.log((n + 1) / count))
  }

  interface Candidate {
    from: string
    to: string
    score: number
  }
  const candidates: Candidate[] = []

  for (let i = 0; i < taggedIds.length; i++) {
    for (let j = i + 1; j < taggedIds.length; j++) {
      const a = taggedIds[i]
      const b = taggedIds[j]
      if (existingPairs.has(pairKey(a, b))) continue // una relación más fuerte ya gana

      const tagsA = tagSets.get(a)!
      const tagsB = tagSets.get(b)!
      let interWeight = 0
      let unionWeight = 0
      const seen = new Set<string>()
      for (const t of tagsA) {
        seen.add(t)
        const w = weight.get(t)!
        unionWeight += w
        if (tagsB.has(t)) interWeight += w
      }
      for (const t of tagsB) {
        if (seen.has(t)) continue
        unionWeight += weight.get(t)!
      }
      const score = unionWeight > 0 ? interWeight / unionWeight : 0
      if (score >= minScore) {
        const [from, to] = a < b ? [a, b] : [b, a]
        candidates.push({ from, to, score })
      }
    }
  }

  // Orden global por score desc (desempate determinístico por el par) y asignación golosa
  // respetando el tope por nodo: así un nodo con más de K vecinos por encima del umbral se
  // queda con sus K MEJORES, no con K cualquiera elegidos por orden de iteración.
  candidates.sort((x, y) => y.score - x.score || x.from.localeCompare(y.from) || x.to.localeCompare(y.to))

  const perNodeCount = new Map<string, number>()
  const edges: MemoryGraphEdge[] = []
  for (const c of candidates) {
    const countFrom = perNodeCount.get(c.from) ?? 0
    const countTo = perNodeCount.get(c.to) ?? 0
    if (countFrom >= maxPerNode || countTo >= maxPerNode) continue
    edges.push({ from: c.from, to: c.to, kind: 'similar', directed: false })
    perNodeCount.set(c.from, countFrom + 1)
    perNodeCount.set(c.to, countTo + 1)
  }
  return edges
}

export function buildMemoryGraph(db: Database.Database, query: MemoryGraphQuery): MemoryGraph {
  // Calificadas con `o.`: desde que la consulta hace JOIN con `projects`, una condicion sin
  // prefijo sobre una columna que existe en las DOS tablas seria ambigua para SQLite.
  const conditions = ['o.deleted = 0']
  const params: unknown[] = []
  if (query.projectKey !== null) {
    conditions.push('o.project_key = ?')
    params.push(query.projectKey)
  }
  if (!query.includeSuperseded) {
    conditions.push('o.superseded_by IS NULL')
  }

  // updated_at DESC con sync_id como desempate: el corte por `limit` (abajo) tiene que ser
  // determinístico para que "los nodos que quedan son los más recientes" sea verificable.
  const rows = db
    .prepare(
      // LEFT JOIN a `projects` por el nombre legible. El `project_key` es un hash
      // (resolveProjectKey), asi que una UI que agrupe por proyecto y muestre la clave
      // cruda le pone al usuario "78b30bb38a968148" en vez del nombre del repo. El LEFT es
      // a proposito: una fila puede referirse a un proyecto que nunca paso por
      // ensureProject(), y esa memoria tiene que seguir apareciendo en el grafo.
      `SELECT o.sync_id, o.project_key, p.display_name AS project_display_name, o.scope,
              o.topic_key, o.type, o.title, o.git_branch, o.origin_ai,
              o.author_display, o.updated_at, o.superseded_by, o.source_ref
       FROM observations o
       LEFT JOIN projects p ON p.project_key = o.project_key
       WHERE ${conditions.join(' AND ')}
       ORDER BY o.updated_at DESC, o.sync_id ASC`
    )
    .all(...params) as GraphRow[]

  const selected = rows.slice(0, query.limit)
  const truncated = rows.length - selected.length

  const nodes: MemoryGraphNode[] = selected.map((r) => ({
    syncId: r.sync_id,
    projectKey: r.project_key,
    projectDisplayName: r.project_display_name,
    title: r.title,
    type: r.type,
    scope: r.scope as 'personal' | 'project' | 'team',
    topicKey: r.topic_key,
    gitBranch: r.git_branch,
    originAi: r.origin_ai,
    authorDisplay: r.author_display,
    updatedAt: r.updated_at,
    superseded: r.superseded_by !== null,
  }))

  const nodeIds = new Set(nodes.map((n) => n.syncId))
  const edges: MemoryGraphEdge[] = []

  // 1. revision — dirigida, del viejo (superseded_by seteado) al nuevo. Sin aristas
  // colgantes: si el sucesor quedó afuera por `limit`, no se emite.
  for (const r of selected) {
    if (r.superseded_by && nodeIds.has(r.superseded_by)) {
      edges.push({ from: r.sync_id, to: r.superseded_by, kind: 'revision', directed: true })
    }
  }

  // 2. topic — cadena por (project_key, scope, topic_key). El scope entra en la clave
  // porque la definición es "dentro del mismo project_key + scope" (brief).
  edges.push(
    ...chainEdges(selected, 'topic', (r) =>
      r.topic_key ? `${r.project_key}\u0000${r.scope}\u0000${r.topic_key}` : null
    )
  )

  // 3. branch — cadena por (project_key, git_branch). Se escopea también por project_key
  // (no solo por nombre de rama): dos repos distintos con una rama "main" no son la misma
  // relación, y un nombre de rama tan común cruzando proyectos sin relación generaría
  // aristas falsas. El brief no lo pide explícito para branch (sí para topic) — ver
  // reporte.
  edges.push(
    ...chainEdges(selected, 'branch', (r) => (r.git_branch ? `${r.project_key}\u0000${r.git_branch}` : null))
  )

  // 4. source — cadena por DOCUMENTO de origen.
  //
  // Es la arista que hacía falta y que no existía. Una memoria IMPORTADA no podía
  // conectarse con NINGUNA otra, por construcción: el importador de Markdown le da a cada
  // chunk su propio `topic_key` (derivado de su heading, así que nunca se repite), y no le
  // pone `git_branch`, ni tags, ni `superseded_by`. O sea que revision, topic, branch y
  // similar eran las cuatro imposibles a la vez. Medido en una cuenta real: ~200 memorias,
  // CERO aristas.
  //
  // Lo que sí existe es de dónde salieron. `source_ref` es `<label>:<path>#<topicKey>`, así
  // que el prefijo hasta el último `#` identifica el documento. Dos secciones del mismo
  // CLAUDE.md comparten origen, y eso es un HECHO declarado, no una inferencia — pertenece
  // al grupo de revision/topic/branch, no al de `similar`.
  edges.push(
    ...chainEdges(selected, 'source', (r) => {
      if (!r.source_ref) return null
      const corte = r.source_ref.lastIndexOf('#')
      const doc = corte > 0 ? r.source_ref.slice(0, corte) : r.source_ref
      // Escopeado por proyecto, igual que branch: dos repos con un CLAUDE.md cada uno no
      // son el mismo documento.
      return `${r.project_key}\u0000${doc}`
    })
  )

  // 5. cross-topic — el mismo topic en OTRO repo. La unica arista de hecho que cruza
  // proyectos; ver crossProjectTopicEdges para por que las otras no lo hacen.
  edges.push(...crossProjectTopicEdges(selected))

  // 6. similar — opt-in (query.includeSimilar), apagada por default. Es inferencia sobre
  // contenido, no un hecho declarado como las tres de arriba (ver MemoryGraphQuery). Si ya
  // hay una arista entre A y B por revision/topic/branch, esa gana y no se duplica.
  if (query.includeSimilar) {
    const existingPairs = new Set(edges.map((e) => pairKey(e.from, e.to)))
    edges.push(
      ...computeSimilarEdges(
        db,
        selected,
        existingPairs,
        query.similarMaxPerNode ?? DEFAULT_SIMILAR_MAX_PER_NODE,
        query.similarMinScore ?? DEFAULT_SIMILAR_MIN_SCORE
      )
    )
  }

  return { nodes, edges, truncated }
}
