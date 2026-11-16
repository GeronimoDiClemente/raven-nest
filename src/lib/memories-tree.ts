// El explorer de Memories: las memorias agrupadas como las carpetas de un vault.
//
// Sale de los nodos del grafo y no de `crossProject`: el grafo ya está cargado para la
// pestaña Graph, trae el proyecto, el scope y la fecha de cada memoria, y no pagina. La
// búsqueda (FTS en main) sólo decide QUÉ ids se ven.
import type { MemoryGraphNode } from '../types'
import { nombreDeProyecto } from './nombre-de-proyecto'

export interface CarpetaDeMemorias { id: string; nombre: string; items: MemoryGraphNode[] }

const CLAVE_GLOBAL = '__global__'

function carpetaDe(n: MemoryGraphNode): { id: string; nombre: string } {
  if (n.scope === 'team') return { id: 'team', nombre: 'Team' }
  if (n.projectKey === CLAVE_GLOBAL) return { id: 'global', nombre: 'Global' }
  return { id: `project:${n.projectKey}`, nombre: nombreDeProyecto(n.projectKey, n.projectDisplayName) }
}

function rango(id: string): number {
  if (id === 'global') return 0
  if (id === 'team') return 2
  return 1
}

export function armarArbol(nodes: MemoryGraphNode[], coincidencias: ReadonlySet<string> | null): CarpetaDeMemorias[] {
  const porId = new Map<string, CarpetaDeMemorias>()
  for (const n of nodes) {
    if (n.pending || n.superseded) continue
    if (coincidencias && !coincidencias.has(n.syncId)) continue
    const { id, nombre } = carpetaDe(n)
    let c = porId.get(id)
    if (!c) { c = { id, nombre, items: [] }; porId.set(id, c) }
    c.items.push(n)
  }
  const carpetas = [...porId.values()]
  for (const c of carpetas) c.items.sort((a, b) => b.updatedAt - a.updatedAt)
  return carpetas.sort((a, b) =>
    rango(a.id) - rango(b.id) || a.nombre.localeCompare(b.nombre, undefined, { sensitivity: 'base' }))
}
