// Spec 2026-09-11 §3: los cuatro tipos de arista se distinguen visualmente, y eso NO es
// decoración. `revision` es dirigida (el linaje de una idea), `topic` y `branch` son
// agrupamientos, y `similar` es inferencia, no un hecho afirmado. Mezclar las cuatro en la
// misma línea gris es lo que hace que un grafo se vea rico y no signifique nada.
//
// Se distinguen por FORMA, no por color: ancho, curvatura y flecha, sobre una rampa de
// grises. Es la misma decisión que el tratamiento B de botones (jerarquía por forma) y la
// que deja intacta la regla de que el color es estado. Los nodos SÍ llevan color, porque
// ahí el color significa el tipo de memoria — la leyenda categórica que ya existe y que ya
// tiene su contraste verificado (memory-type-legend.ts).
//
// Todo acá es una función pura sobre datos: el render vive en MemoryGraph3D.tsx, que es el
// chunk pesado y diferido. Así la lógica que decide qué significa cada cosa se puede testear
// sin montar WebGL.
import type { MemoryEdgeKind, MemoryGraph, MemoryGraphNode } from '../types'
import { memoryTypeSwatch } from './memory-type-legend'

/** Nodo tal como lo consume react-force-graph-3d. `id` es el `syncId`. */
export interface GraphNodeDatum {
  id: string
  label: string
  color: string
  /** Área relativa del nodo. Una memoria reemplazada se dibuja más chica: sigue en el
   *  linaje pero ya no es la versión vigente. */
  val: number
  superseded: boolean
  type: string
  projectLabel: string | null
}

export interface GraphLinkDatum {
  source: string
  target: string
  kind: MemoryEdgeKind
}

export interface GraphData {
  nodes: GraphNodeDatum[]
  links: GraphLinkDatum[]
}

/** Gris neutro para un tipo que no está en la leyenda fija — nunca un color inventado
 *  (mismo criterio que `memoryTypeSwatch`, que devuelve null). */
const NEUTRAL_NODE = '#8a8a8a'

export interface EdgeStyle {
  /** Grosor de la línea. */
  width: number
  /** Gris con alfa. La rampa va de lo afirmado (claro, opaco) a lo inferido (tenue). */
  color: string
  /** 0 = recta. Las agrupaciones se curvan para leerse como "estos van juntos" en vez de
   *  "esto llevó a esto". */
  curvature: number
  /** Largo de la punta de flecha; 0 = sin flecha. Solo `revision` la tiene, porque es la
   *  única dirigida. */
  arrowLength: number
  /** Para la leyenda de la UI. */
  label: string
  /** Qué afirma esta arista. Lo lee el tooltip de la leyenda: la diferencia entre un hecho
   *  y una inferencia tiene que estar escrita, no solo dibujada. */
  meaning: string
}

export const EDGE_STYLES: Record<MemoryEdgeKind, EdgeStyle> = {
  // El linaje: esta memoria reemplazó a aquella. Es la única con dirección, y la más
  // marcada — es la relación que cuenta una historia.
  revision: {
    width: 2,
    color: 'rgba(232, 232, 232, 0.85)',
    curvature: 0,
    arrowLength: 3.5,
    label: 'Revision',
    meaning: 'This memory replaced that one',
  },
  // Mismo topic_key: alguien las agrupó bajo el mismo tema.
  topic: {
    width: 1.2,
    color: 'rgba(180, 180, 180, 0.5)',
    curvature: 0.25,
    arrowLength: 0,
    label: 'Same topic',
    meaning: 'Saved under the same topic',
  },
  // Misma rama de git: se escribieron trabajando en lo mismo.
  branch: {
    width: 1.2,
    color: 'rgba(140, 140, 140, 0.38)',
    curvature: -0.25,
    arrowLength: 0,
    label: 'Same branch',
    meaning: 'Written while working on the same branch',
  },
  // La única que nadie afirmó: la calculamos nosotros por tags compartidos. Va apagada por
  // default y se dibuja como lo que es — la más tenue y la más fina.
  similar: {
    width: 0.6,
    color: 'rgba(120, 120, 120, 0.22)',
    curvature: 0.5,
    arrowLength: 0,
    label: 'Similar',
    meaning: 'Guessed from shared tags — not something anyone stated',
  },
}

/** El orden en que la leyenda los lista: de lo afirmado a lo inferido. */
export const EDGE_KINDS_IN_LEGEND_ORDER: MemoryEdgeKind[] = ['revision', 'topic', 'branch', 'similar']

function nodeLabel(node: MemoryGraphNode): string {
  return node.title.trim() || '(untitled)'
}

/**
 * Traduce el grafo del store al formato del render.
 *
 * Dos cosas que NO hace a propósito:
 * - No filtra `similar`: eso lo decide la capa de datos vía `includeSimilar` en la query,
 *   que es donde ya vive la decisión (no se piden y después se tiran).
 * - No descarta aristas con puntas faltantes en silencio. Si el store devolviera una arista
 *   hacia un nodo que no vino (por el `limit`), react-force-graph la trataría como un nodo
 *   nuevo sin datos y aparecería un punto fantasma sin título ni color. Se filtran acá, que
 *   es el único lugar donde se sabe qué nodos llegaron.
 */
export function toGraphData(graph: MemoryGraph): GraphData {
  const nodes: GraphNodeDatum[] = graph.nodes.map((n) => ({
    id: n.syncId,
    label: nodeLabel(n),
    color: memoryTypeSwatch(n.type)?.color ?? NEUTRAL_NODE,
    val: n.superseded ? 1 : 2.5,
    superseded: n.superseded,
    type: n.type,
    projectLabel: n.gitBranch,
  }))

  const presentes = new Set(nodes.map((n) => n.id))
  const links: GraphLinkDatum[] = graph.edges
    .filter((e) => presentes.has(e.from) && presentes.has(e.to))
    .map((e) => ({ source: e.from, target: e.to, kind: e.kind }))

  return { nodes, links }
}

/** Cuántas aristas de cada tipo hay. Lo usa la leyenda para no ofrecer un tipo que no
 *  aparece en el grafo que se está mirando. */
export function countEdgeKinds(data: GraphData): Record<MemoryEdgeKind, number> {
  const out: Record<MemoryEdgeKind, number> = { revision: 0, topic: 0, branch: 0, similar: 0 }
  for (const l of data.links) out[l.kind] += 1
  return out
}
