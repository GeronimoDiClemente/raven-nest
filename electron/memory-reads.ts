// Las lecturas de memoria, como funciones sobre una `Database` y no como métodos del store.
//
// **Por qué existen acá.** El modo sin daemon (`memory-mcp/readonly.ts`) abre el SQLite en
// sólo lectura y responde sin la app. Hasta ahora lo único que sabía contestar era el grafo,
// porque `buildMemoryGraph` ya era una función sobre `db` — mientras que buscar, traer el
// contexto y leer una memoria por id vivían como métodos de `MemoryStore`, y `MemoryStore`
// no se puede instanciar contra una base de sólo lectura: su constructor corre las
// migraciones y prende WAL, o sea escribe.
//
// El efecto era que quien se llevaba el plugin a otro editor podía ver el dibujo del grafo
// pero no podía BUSCAR ni LEER una memoria, que es para lo que sirve tener memoria. Las tres
// consultas son `SELECT` puros: lo único que las ataba a la clase era dónde estaban escritas.
//
// `MemoryStore` las llama a éstas, así que hay una sola redacción de cada consulta. Si mañana
// `search` cambia de criterio, cambia para los dos caminos a la vez — que es justo lo que no
// pasaría con una copia.
import type { Database } from 'better-sqlite3'
import type { ObservationSummary, ObservationType } from './memory-protocol'
// `import type` a propósito: se borra al compilar, así que esto NO crea un ciclo en runtime
// con `memory-store.ts` —que importa las funciones de acá— aunque el tipo viva allá.
import type { ObservationRow } from './memory-store'

/** La fila como la ve quien consume la memoria: sin columnas de replicación. */
export function toSummary(row: ObservationRow): ObservationSummary {
  return {
    syncId: row.sync_id,
    title: row.title,
    // search()/context() ya filtran deleted=0, así que una fila tombstoneada (content null)
    // no llega acá en la práctica — el fallback es defensivo, no carga peso.
    content: row.content ?? '',
    type: row.type as ObservationType,
    topicKey: row.topic_key,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
    updatedAt: row.updated_at,
    originAi: row.origin_ai,
    gitBranch: row.git_branch,
  }
}

/**
 * Búsqueda por texto sobre la tabla FTS5. Trae las del proyecto pedido **y** las globales:
 * una memoria global es, por definición, algo que vale más allá de un repo.
 *
 * `projectKey: null` busca en **todos** los proyectos. Lo usa el modo sin daemon cuando no
 * puede resolver de qué repo le están preguntando: ahí un resultado vacío sería
 * indistinguible de "no hay nada guardado", y esa confusión es peor que devolver de más.
 */
export function searchObservations(
  db: Database,
  projectKey: string | null,
  globalProjectKey: string,
  query: string,
  limit = 10
): ObservationSummary[] {
  const safe = query.replace(/["]/g, '')
  if (!safe.trim()) return []
  const filtro = projectKey === null ? '' : 'AND (o.project_key = ? OR o.project_key = ?)'
  const args: unknown[] = projectKey === null ? [] : [projectKey, globalProjectKey]
  const rows = db
    .prepare(
      `SELECT o.* FROM observations o
       JOIN observations_fts f ON f.rowid = o.rowid
       WHERE observations_fts MATCH ? AND o.deleted = 0 AND o.superseded_by IS NULL
         ${filtro}
       ORDER BY o.updated_at DESC, o.lamport DESC LIMIT ?`
    )
    .all(`"${safe}"`, ...args, limit) as ObservationRow[]
  return rows.map(toSummary)
}

/**
 * Lo último de un proyecto, sin filtro.
 *
 * `updated_at` es un `Date.now()` en ms: dos escrituras en el mismo milisegundo (rutina en un
 * test rápido, y no imposible para un agente charlatán) empatan bajo un `ORDER BY updated_at`
 * pelado, y SQLite no garantiza que el empate se resuelva en orden de escritura. `lamport`
 * existe justo para dar un orden total más fino que el reloj (§4.3), así que es la clave
 * secundaria correcta en cualquier orden por recencia.
 */
export function contextObservations(
  db: Database,
  projectKey: string | null,
  globalProjectKey: string,
  limit = 10
): ObservationSummary[] {
  const filtro = projectKey === null
    ? ''
    : '(project_key = ? OR project_key = ?) AND'
  const args: unknown[] = projectKey === null ? [] : [projectKey, globalProjectKey]
  const rows = db
    .prepare(
      `SELECT * FROM observations
       WHERE ${filtro} deleted = 0 AND superseded_by IS NULL
       ORDER BY updated_at DESC, lamport DESC LIMIT ?`
    )
    .all(...args, limit) as ObservationRow[]
  return rows.map(toSummary)
}

/**
 * Qué `project_key` le corresponde a un directorio, **según lo que la base ya registró**.
 *
 * Con la app abierta la clave sale del remote de git (`resolveProjectKey`), así que derivarla
 * del path a secas daría OTRA clave y la búsqueda devolvería vacío en silencio — el peor
 * resultado posible: "no hay nada guardado de este repo" cuando sí hay. La tabla `projects`
 * guarda el `root_path` con el que se enroló, así que acá se pregunta en vez de adivinar.
 *
 * `null` cuando ese directorio no está enrolado; quien llama decide el fallback.
 */
export function projectKeyForRootPath(db: Database, rootPath: string): string | null {
  const row = db
    .prepare('SELECT project_key FROM projects WHERE root_path = ? LIMIT 1')
    .get(rootPath) as { project_key: string } | undefined
  return row?.project_key ?? null
}

/** La fila cruda por su id, borrada o no — quien llama decide qué hacer con una tombstone. */
export function getObservation(db: Database, syncId: string): ObservationRow | null {
  return (db.prepare('SELECT * FROM observations WHERE sync_id = ?').get(syncId) as ObservationRow) ?? null
}

/** La fila por id, ya lista para consumir. `null` también cuando está borrada. */
export function getObservationSummary(db: Database, syncId: string): ObservationSummary | null {
  const row = getObservation(db, syncId)
  if (!row || row.deleted !== 0) return null
  return toSummary(row)
}
