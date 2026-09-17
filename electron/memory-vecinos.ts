import type { Database } from 'better-sqlite3'
import { parsearWikilinks, resolverWikilink, type CandidatoMemoria } from './wikilinks'
import type { VecinoDeMemoria } from './memory-protocol'

export type { VecinoDeMemoria }

/**
 * Los vecinos de una memoria: con qué otras está conectada, y para qué lado.
 *
 * Existe para que recuperar sea CAMINAR el grafo en vez de volver a buscar. El tipo
 * `VecinoDeMemoria` vive en `memory-protocol.ts` — ver ahí por qué.
 */

interface FilaBase {
  sync_id: string
  project_key: string
  title: string
  topic_key: string | null
  content: string | null
}

/**
 * Vecinos de `syncId`, en orden estable por id.
 *
 * La dirección SALIENTE es barata: se parsea el texto de esta memoria y se resuelven los
 * nombres. La ENTRANTE —el backlink— es la cara, porque exige saber quién menciona a quién:
 * se angosta con FTS5 buscando el título y el topic como frase, y recién sobre esos
 * candidatos se corre el parser para confirmar que la mención es un link de verdad y no el
 * título apareciendo suelto en una oración. Es la misma distinción que hace Obsidian entre
 * "linked mentions" y "unlinked mentions", y acá sólo devolvemos las primeras.
 *
 * No cruza proyectos: el vault de una memoria es su repo.
 */
export function vecinosDeMemoria(db: Database, syncId: string): VecinoDeMemoria[] {
  const fila = db
    .prepare('SELECT sync_id, project_key, title, topic_key, content FROM observations WHERE sync_id = ? AND deleted = 0')
    .get(syncId) as FilaBase | undefined
  if (!fila) return []

  const candidatos = db
    .prepare('SELECT sync_id, title, topic_key FROM observations WHERE project_key = ? AND deleted = 0')
    .all(fila.project_key) as Array<{ sync_id: string; title: string; topic_key: string | null }>

  const comoCandidato: CandidatoMemoria[] = candidatos.map((c) => ({
    syncId: c.sync_id, title: c.title, topicKey: c.topic_key,
  }))
  const porId = new Map(candidatos.map((c) => [c.sync_id, c]))

  // Clave por vecino: un mismo par no se lista dos veces. Gana el wikilink sobre el manual
  // porque dice ADEMAS para que lado va, que es informacion que el manual no tiene.
  const vecinos = new Map<string, VecinoDeMemoria>()
  const agregar = (id: string, direction: VecinoDeMemoria['direction'], via: VecinoDeMemoria['via']) => {
    if (id === syncId) return
    const c = porId.get(id)
    if (!c) return
    const previo = vecinos.get(id)
    if (previo && !(previo.via === 'manual' && via === 'wikilink')) return
    vecinos.set(id, { syncId: id, title: c.title, topicKey: c.topic_key, direction, via })
  }

  // --- salientes: lo que ESTA memoria menciona
  for (const nombre of parsearWikilinks(fila.content ?? '')) {
    const destino = resolverWikilink(nombre, comoCandidato)
    if (destino) agregar(destino, 'outgoing', 'wikilink')
  }

  // --- entrantes: quien menciona a ESTA
  for (const frase of [fila.title, fila.topic_key]) {
    if (!frase || !frase.trim()) continue
    // Mismo saneo que search(): FTS5 no permite comillas dobles sueltas en una MATCH
    // expression, y envolver en comillas fuerza frase exacta en vez de dejar que los
    // tokens se interpreten como operadores.
    const seguro = frase.replace(/["]/g, '').trim()
    if (!seguro) continue
    let candidatosFts: Array<{ sync_id: string; content: string | null }> = []
    try {
      candidatosFts = db
        .prepare(
          `SELECT o.sync_id, o.content FROM observations o
             JOIN observations_fts f ON f.rowid = o.rowid
            WHERE observations_fts MATCH ? AND o.deleted = 0 AND o.project_key = ?`,
        )
        .all(`"${seguro}"`, fila.project_key) as Array<{ sync_id: string; content: string | null }>
    } catch {
      // Una frase que sanea a algo que FTS5 igual rechaza no puede tumbar la lectura entera:
      // se pierden los backlinks por ese nombre, no los vecinos.
      continue
    }
    for (const cand of candidatosFts) {
      if (cand.sync_id === syncId) continue
      // El FTS solo angosto: que el titulo aparezca en el texto no lo hace un link. Esto es
      // lo que separa una "linked mention" de una "unlinked mention".
      const apunta = parsearWikilinks(cand.content ?? '')
        .some((n) => resolverWikilink(n, comoCandidato) === syncId)
      if (apunta) agregar(cand.sync_id, 'incoming', 'wikilink')
    }
  }

  // --- conectadas a mano: sin sentido propio, va y viene igual
  const manuales = db
    .prepare('SELECT a, b FROM memory_links WHERE a = ? OR b = ?')
    .all(syncId, syncId) as Array<{ a: string; b: string }>
  for (const l of manuales) agregar(l.a === syncId ? l.b : l.a, 'both', 'manual')

  return [...vecinos.values()].sort((x, y) => (x.syncId < y.syncId ? -1 : x.syncId > y.syncId ? 1 : 0))
}
