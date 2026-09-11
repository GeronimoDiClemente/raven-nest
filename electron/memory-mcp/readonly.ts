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
import type { MemoryMethod } from '../memory-protocol'

/** Lo que el modo sin daemon sabe responder. El resto necesita la app. */
const LEGIBLES: ReadonlySet<MemoryMethod> = new Set<MemoryMethod>(['memory.graph', 'ping'])

export function esMetodoDeLectura(method: MemoryMethod): boolean {
  return LEGIBLES.has(method)
}

/**
 * Mensaje único para todo lo que necesita la app. Dice qué falta y qué hacer, en vez de un
 * error de transporte — quien lo lee es un agente que tiene que decidir si reintentar.
 */
export const SIN_APP =
  'Nest is not running, so memory is read-only right now. Reading (memory_graph) works; ' +
  'saving, updating and promoting need the Nest app open — it is what keeps the replicas in ' +
  'sync. Open Nest and try again, or tell the user what you would have saved so it is not lost.'

export class MemoryReadonlyClient {
  private db: Database.Database | null = null

  constructor(private readonly ravenHomeDir: string) {}

  /**
   * `null` cuando no hay nada que abrir: sin puntero de cuenta activa, o con un puntero que
   * apunta a un archivo que ya no está. Los dos casos son lo mismo para quien llama.
   */
  private abrir(): Database.Database | null {
    if (this.db) return this.db
    const pointer = readActivePointer(this.ravenHomeDir)
    if (!pointer) return null
    try {
      // `fileMustExist` además de `readonly`: sin él, better-sqlite3 CREA un archivo vacío si
      // el path no existe, y el modo sin daemon terminaría inventando una base en blanco y
      // reportando "no hay memorias" en vez de "no encontré la base".
      this.db = new Database(pointer.storePath, { readonly: true, fileMustExist: true })
      return this.db
    } catch (err) {
      console.error('[nest-memory] no se pudo abrir la base en sólo lectura:', (err as Error).message)
      return null
    }
  }

  async call<T = unknown>(method: MemoryMethod, params: unknown): Promise<T> {
    if (method === 'ping') return { ok: true } as T
    if (!esMetodoDeLectura(method)) throw new Error(SIN_APP)

    const db = this.abrir()
    if (!db) {
      throw new Error(
        'Nest is not running and no memory database was found for this machine. ' +
        'Open Nest once so it can record which account is active.'
      )
    }

    const p = (params ?? {}) as {
      projectKey?: string | null
      tag?: string | null
      includeSimilar?: boolean
      limit?: number
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
