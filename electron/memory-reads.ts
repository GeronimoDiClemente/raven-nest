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
/**
 * Corta un texto en el limite pedido, en el ultimo corte limpio que encuentre.
 *
 * Prefiere terminar en un parrafo, y si no hay, en una oracion, y si no hay, en una palabra.
 * Un corte a la mitad de una palabra le hace creer al modelo que el texto sigue y lo empuja a
 * completar lo que falta en vez de pedirlo.
 */
/**
 * El presupuesto de `memory_context`, en caracteres por memoria.
 *
 * 400 es lo que entra el "que/por que" de una memoria bien escrita —el formato que la propia
 * descripcion de `memory_save` pide— sin el "donde" ni los detalles. Alcanza para decidir
 * cual abrir, que es para lo que existe este escalon.
 *
 * Con diez memorias son ~4 KB (~1.000 tokens) contra los ~18 KB (~4.500) del volcado entero.
 */
export const CONTEXT_MAX_CHARS = 400

export function recortar(texto: string, maxChars: number): { texto: string; cortado: boolean } {
  if (texto.length <= maxChars) return { texto, cortado: false }
  const ventana = texto.slice(0, maxChars)
  // `conserva` = cuantos caracteres del separador se quedan del lado cortado. El punto de
  // una oracion es parte de la oracion; el salto de linea y el espacio no son parte de nada.
  const SEPARADORES: Array<{ sep: string; conserva: number }> = [
    { sep: '\n\n', conserva: 0 },
    { sep: '. ', conserva: 1 },
    { sep: '\n', conserva: 0 },
    { sep: ' ', conserva: 0 },
  ]
  for (const { sep, conserva } of SEPARADORES) {
    const i = ventana.lastIndexOf(sep)
    // El corte tiene que estar en la segunda mitad: si el unico parrafo termina en el
    // caracter 20 de un limite de 400, cortar ahi tira el 95% por nada.
    if (i > maxChars * 0.5) {
      return { texto: ventana.slice(0, i + conserva).trimEnd(), cortado: true }
    }
  }
  return { texto: ventana.trimEnd(), cortado: true }
}

export function toSummary(row: ObservationRow, maxContentChars?: number): ObservationSummary {
  return {
    syncId: row.sync_id,
    title: row.title,
    // search()/context() ya filtran deleted=0, así que una fila tombstoneada (content null)
    // no llega acá en la práctica — el fallback es defensivo, no carga peso.
    ...(() => {
      const entero = row.content ?? ''
      if (maxContentChars === undefined) return { content: entero }
      const { texto, cortado } = recortar(entero, maxContentChars)
      return cortado ? { content: texto, contentTruncated: true } : { content: texto }
    })(),
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
/**
 * Lo que el agente ya sabe de este proyecto, para el arranque de una sesion.
 *
 * `maxContentChars` es lo que lo vuelve barato, y es la razon de ser de esta funcion.
 *
 * Sin presupuesto, esto devolvia diez memorias con el CUERPO ENTERO. Con el promedio real
 * del corpus (1793 bytes) son ~18 KB, o sea unos 4.500 tokens, en CADA arranque de sesion —
 * y la descripcion de la herramienta le decia al modelo que era "cheap", que es justo lo que
 * hace que la llame sin pensarlo. Un procesador de memoria bien administrado no vuelca: da
 * un indice y deja que pidan el detalle de lo que importa.
 *
 * La cadena queda en tres escalones, cada uno mas caro y mas especifico que el anterior:
 *
 *   1. `SessionStart` (automatico, gratis)  — cinco titulos. El agente se entera de que hay
 *      memoria sin haber pedido nada.
 *   2. `memory_context` (una llamada)       — el indice con el principio de cada una: alcanza
 *      para decidir CUAL importa.
 *   3. `memory_get` (por memoria)           — el texto entero, solo de las que eligio.
 *
 * Pagar el paso 3 por diez memorias cuando el agente necesitaba dos es exactamente el
 * desperdicio de contexto que la feature existe para resolver.
 */
export function contextObservations(
  db: Database,
  projectKey: string | null,
  globalProjectKey: string,
  limit = 10,
  maxContentChars?: number
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
  return rows.map((r) => toSummary(r, maxContentChars))
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
