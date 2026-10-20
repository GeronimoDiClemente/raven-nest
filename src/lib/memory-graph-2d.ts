// Lo puro del grafo 2D: qué arista es inferida, vecinos, el subgrafo local y el atenuado.
import type { MemoryEdgeKind } from '../types'
import type { GraphData, GraphLinkDatum } from './memory-graph-visuals'

export const ARISTAS_AFIRMADAS: ReadonlySet<MemoryEdgeKind> = new Set<MemoryEdgeKind>(['manual', 'wikilink', 'revision'])

export function esInferida(kind: MemoryEdgeKind): boolean { return !ARISTAS_AFIRMADAS.has(kind) }

/** react-force-graph muta `source`/`target` a objetos después del primer tick. */
export function idDe(x: unknown): string {
  return typeof x === 'string' ? x : String((x as { id: string }).id)
}

export function vecinos(links: GraphLinkDatum[], id: string): Set<string> {
  const out = new Set<string>()
  for (const l of links) {
    const s = idDe(l.source), t = idDe(l.target)
    if (s === id) out.add(t)
    if (t === id) out.add(s)
  }
  return out
}

export function subgrafoLocal(data: GraphData, foco: string, saltos: 1 | 2): GraphData {
  const dentro = new Set([foco])
  let frontera = new Set([foco])
  for (let i = 0; i < saltos; i++) {
    const nueva = new Set<string>()
    for (const id of frontera) for (const v of vecinos(data.links, id)) if (!dentro.has(v)) { dentro.add(v); nueva.add(v) }
    frontera = nueva
  }
  return {
    nodes: data.nodes.filter((n) => dentro.has(n.id)),
    links: data.links.filter((l) => dentro.has(idDe(l.source)) && dentro.has(idDe(l.target))),
    orphansHidden: 0,
  }
}

const ATENUADO = 0.15

export function opacidadDeNodo(id: string, hover: string | null, vecinosDelHover: ReadonlySet<string>, resaltados: ReadonlySet<string> | null): number {
  if (hover) return id === hover || vecinosDelHover.has(id) ? 1 : ATENUADO
  if (resaltados) return resaltados.has(id) ? 1 : ATENUADO
  return 1
}
