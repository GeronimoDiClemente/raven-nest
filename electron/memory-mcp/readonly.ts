// El modo sin daemon: leer la memoria con Nest cerrado.
//
// **Por qué existe.** El shim normal reenvía todo al daemon que corre adentro de Electron, y
// si no encuentra el socket se apaga con "memory is disabled for this session". O sea que
// hasta hoy la memoria era una función de la APP: quien se llevaba el plugin a otro editor
// y no tenía Nest abierto, se quedaba sin nada. Eso es exactamente lo que no puede pasar si
// la memoria es la feature.
//
// **Qué hace y qué no.** Abre el SQLite en SÓLO LECTURA y responde las consultas. No escribe
// nunca, y no es un descuido: el daemon es quien sincroniza, quien resuelve los conflictos y
// quien lleva el `lamport`. Un segundo escritor sin esa coordinación produce divergencias que
// el merge no puede arreglar después. Escribir sigue necesitando la app, y cuando no está, se
// dice con todas las letras en vez de fallar raro.
//
// Dos lectores concurrentes sobre el mismo archivo son seguros: el store abre en WAL, que
// admite lectores mientras alguien escribe.
import Database from 'better-sqlite3'
import { buildMemoryGraph, type MemoryGraph } from '../memory-graph'
import { renderMemoryGraphText } from '../memory-graph-text'
import { readActivePointer } from '../memory-active-store'
import { contextObservations, getObservationSummary, projectKeyForRootPath, searchObservations } from '../memory-reads'
import { GLOBAL_PROJECT_KEY, resolveProjectKey } from '../memory-project-key'
import type { MemoryMethod, ObservationSummary } from '../memory-protocol'

/**
 * Lo que el modo sin daemon sabe responder: **todo lo que es leer**.
 *
 * Antes acá estaba sólo `memory.graph`, y no por diseño sino porque `buildMemoryGraph` era
 * la única lectura que ya existía como función sobre `db`. El resultado era que quien se
 * llevaba el plugin a otro editor veía el DIBUJO de sus memorias pero no podía buscar
 * ninguna ni abrir una — o sea, tenía el mapa y no el contenido. `memory-reads.ts` sacó las
 * otras tres del store, así que ahora entran.
 */
const LEGIBLES: ReadonlySet<MemoryMethod> = new Set<MemoryMethod>([
  'memory.graph', 'memory.search', 'memory.context', 'memory.get', 'ping',
])

export function esMetodoDeLectura(method: MemoryMethod): boolean {
  return LEGIBLES.has(method)
}

/**
 * Mensaje único para todo lo que necesita la app. Dice qué falta y qué hacer, en vez de un
 * error de transporte — quien lo lee es un agente que tiene que decidir si reintentar.
 */
export const SIN_APP =
  'Nest is not running, so memory is read-only right now. Reading works — memory_search, ' +
  'memory_context, memory_get and memory_graph all answer from disk. Saving, updating and ' +
  'promoting need the Nest app open: it is what keeps the replicas in sync. Open Nest and try ' +
  'again, or tell the user what you would have saved so it is not lost.'

export class MemoryReadonlyClient {
  private db: Database.Database | null = null

  constructor(private readonly ravenHomeDir: string) {}

  /**
   * `null` cuando no hay nada que abrir: sin puntero de cuenta activa, o con un puntero que
   * apunta a un archivo que ya no está. Los dos casos son lo mismo para quien llama.
   */
  private abrir(): Database.Database {
    if (this.db) return this.db
    const pointer = readActivePointer(this.ravenHomeDir)
    if (!pointer) {
      throw new Error(
        'Nest is not running and no memory database was found for this machine. ' +
        'Open Nest once so it can record which account is active.'
      )
    }
    try {
      // `fileMustExist` además de `readonly`: sin él, better-sqlite3 CREA un archivo vacío si
      // el path no existe, y el modo sin daemon terminaría inventando una base en blanco y
      // reportando "no hay memorias" en vez de "no encontré la base".
      const db = new Database(pointer.storePath, { readonly: true, fileMustExist: true })
      // `new Database` no toca el archivo: better-sqlite3 abre en diferido, así que un
      // archivo que no es una base —o un binding nativo incompatible— recién explota en la
      // primera consulta, lejos de acá y con el catch de abajo ya fuera de alcance. Este
      // pragma es la consulta que fuerza el fallo mientras todavía se puede explicar.
      db.pragma('user_version')
      this.db = db
      return db
    } catch (err) {
      // Dos fallas distintas necesitan dos mensajes distintos. Antes las dos colapsaban en
      // "no encontré la base, abrí Nest una vez", que para un binding nativo incompatible
      // es MENTIRA —el archivo está, el puntero está— y manda a hacer algo que no arregla
      // nada. Quien lee esto es un agente que tiene que decidir si reintentar o avisar.
      const detalle = err instanceof Error ? err.message : String(err)
      throw new Error(
        `The memory database exists at ${pointer.storePath} but could not be opened: ${detalle}`
      )
    }
  }

  async call<T = unknown>(method: MemoryMethod, params: unknown): Promise<T> {
    if (method === 'ping') return { ok: true } as T
    if (!esMetodoDeLectura(method)) throw new Error(SIN_APP)

    const db = this.abrir()

    const p = (params ?? {}) as {
      projectKey?: string | null
      tag?: string | null
      includeSimilar?: boolean
      limit?: number
      query?: string
      syncId?: string
      cwd?: string
    }

    // `memory_search` y `memory_context` llegan con el `cwd` del agente, no con una clave de
    // proyecto: la clave la deriva el daemon. Sin daemon se pregunta a la tabla `projects`,
    // que guarda el `root_path` con el que el repo se enroló — derivarla del path a secas
    // daría otra clave cuando el repo tiene remote, y la respuesta sería un "no hay nada de
    // este repo" falso.
    // `null` = todos los proyectos. Es el caso de un repo que nunca se abrió en Nest, que
    // para quien se llevó el plugin a otro editor es lo NORMAL, no la excepción: filtrar por
    // una clave que la base no conoce devolvería vacío, y un vacío que en realidad significa
    // "no supe de qué repo me hablás" es indistinguible de "no tenés nada guardado".
    const claveDeProyecto = (): string | null => {
      if (p.projectKey) return p.projectKey
      if (!p.cwd) return null
      const enrolado = projectKeyForRootPath(db, p.cwd)
      if (enrolado) return enrolado
      const derivada = resolveProjectKey({ rootPath: p.cwd })
      // Derivarla del path sólo sirve si la base la conoce: con remote de git la clave sale
      // del remote, así que la del path sería otra y no matchearía nada.
      const conocida = db
        .prepare('SELECT 1 FROM observations WHERE project_key = ? LIMIT 1')
        .get(derivada)
      return conocida ? derivada : null
    }

    // Las tres lecturas que no son el grafo. Devuelven la MISMA forma que devuelve el daemon
    // (`memory-ipc-server.ts`), porque del otro lado hay un agente que no sabe —ni tiene por
    // qué saber— si Nest estaba abierto cuando preguntó.
    // `offline: true` en las tres. El grafo lo dice en su propio texto; éstas devuelven JSON
    // y sin la marca el agente no tiene forma de saber que está mirando una foto del disco,
    // que puede estar atrás de lo que la nube ya tiene. Campo agregado, no cambiado: la forma
    // que ya devolvía el daemon sigue igual.
    if (method === 'memory.search') {
      const items = searchObservations(
        db, claveDeProyecto(), GLOBAL_PROJECT_KEY, p.query ?? '', p.limit ?? 10
      )
      return { items, offline: true } as T
    }
    if (method === 'memory.context') {
      const items = contextObservations(
        db, claveDeProyecto(), GLOBAL_PROJECT_KEY, p.limit ?? 10
      )
      return { items, offline: true } as T
    }
    if (method === 'memory.get') {
      const item: ObservationSummary | null = p.syncId ? getObservationSummary(db, p.syncId) : null
      return { item, offline: true } as T
    }

    const graph: MemoryGraph = buildMemoryGraph(db, {
      projectKey: p.projectKey ?? null,
      // Las reemplazadas entran: la arista `revision` es el linaje de una idea y sin ellas no
      // hay linaje. Mismo criterio que el camino con daemon.
      includeSuperseded: true,
      includeSimilar: p.includeSimilar ?? false,
      limit: p.limit ?? 200,
    })

    const filtrado = p.tag
      ? { ...graph, nodes: graph.nodes.filter((n) => n.tags.includes(p.tag!)) }
      : graph
    const ids = new Set(filtrado.nodes.map((n) => n.syncId))
    const conAristas = { ...filtrado, edges: filtrado.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) }

    const encabezado = p.tag ? `#${p.tag}` : p.projectKey ? p.projectKey : 'Todas las memorias'
    // El aviso va en el propio dibujo: quien lo lee tiene que saber que está mirando una foto
    // de lo que hay en disco, que puede estar atrás de lo que la nube ya tiene.
    const texto = `${renderMemoryGraphText(conAristas, { encabezado })}\n\n(Nest cerrado — lectura directa del disco, sin sincronizar.)`
    return { text: texto } as T
  }

  close(): void {
    try { this.db?.close() } catch { /* cerrar una base ya cerrada no es un problema */ }
    this.db = null
  }
}
