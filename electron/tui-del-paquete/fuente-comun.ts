// Lo que las dos fuentes comparten: armar los pedidos del protocolo y leer las respuestas.
// Sólo imports de tipos y de `fs`/`path`: la fuente de Nest corre en el Node 20 de Electron y
// no puede arrastrar nada que llegue a `node:sqlite`.
import { existsSync } from 'fs'
import { basename, dirname, join } from 'path'
import type {
  ObservationSummary, GetMemoryResult, UpdateMemoryResult, SaveMemoryParams, UpdateMemoryParams,
} from '../memory-protocol'
import type { DetalleDeMemoria } from './estado'
import type { MemoriaEscrita } from './frontmatter'
import { ErrorDeEscritura } from './fuente'

/** Cualquier cosa con un `call` como el de los clientes del MCP. */
export interface Llamador { call: (method: any, params: unknown) => Promise<any> }

/**
 * El nombre del proyecto: la carpeta que tiene `.git` subiendo desde el cwd, o el cwd mismo.
 * Síncrono y sin lanzar `git`: la TUI lo pide al pintar.
 */
export function nombreDelProyecto(cwd: string): string {
  let dir = cwd
  for (;;) {
    if (existsSync(join(dir, '.git'))) return basename(dir) || dir
    const padre = dirname(dir)
    if (padre === dir) return basename(cwd) || cwd
    dir = padre
  }
}

export async function leerRecientes(c: Llamador, cwd: string, o: { todos: boolean; limite: number }): Promise<ObservationSummary[]> {
  const r = await c.call('memory.context', { cwd, limit: o.limite, allProjects: o.todos })
  return (r as { items: ObservationSummary[] }).items
}

export async function leerBusqueda(c: Llamador, cwd: string, consulta: string, limite: number): Promise<ObservationSummary[]> {
  const r = await c.call('memory.search', { cwd, query: consulta, limit: limite })
  return (r as { items: ObservationSummary[] }).items
}

export async function leerDetalle(c: Llamador, cwd: string, syncId: string): Promise<DetalleDeMemoria | null> {
  const r = (await c.call('memory.get', { cwd, syncId })) as GetMemoryResult
  if (!r.item) return null
  // Un daemon de un Nest más viejo no manda los links: sin el `?? []`, el detalle revienta en
  // cuanto el contenido tiene un `[[…]]`.
  // Sólo los backlinks por `[[...]]`, como el «Mentioned in» de la app: una conexión manual no
  // tiene lado.
  const mencionadaEn = (r.neighbors ?? [])
    .filter((v) => v.direction === 'incoming' && v.via === 'wikilink')
    .map((v) => ({ syncId: v.syncId, title: v.title }))
  return {
    item: r.item, pendingLinks: r.pendingLinks ?? [], resolvedLinks: r.resolvedLinks ?? [], mencionadaEn,
    ...(r.scope ? { scope: r.scope } : {}),
    ...(typeof r.revisionCount === 'number' ? { revisiones: r.revisionCount } : {}),
  }
}

export function pedidoDeGuardar(cwd: string, m: MemoriaEscrita): SaveMemoryParams {
  return { cwd, title: m.title, content: m.content, type: m.type, tags: m.tags, source: 'ui' }
}

export function pedidoDeActualizar(cwd: string, syncId: string, m: MemoriaEscrita): UpdateMemoryParams {
  return { cwd, syncId, title: m.title, content: m.content, tags: m.tags, type: m.type }
}

/** `unchanged` no es error; que ya no exista, esté borrada o reemplazada, sí. */
export function verificarActualizacion(r: UpdateMemoryResult): void {
  if (r.updated) return
  if (r.reason === 'not_found' || r.reason === 'deleted' || r.reason === 'superseded') {
    throw new ErrorDeEscritura(`This memory changed elsewhere (${r.reason}). Your text is kept.`)
  }
}

export function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
