// Cómo se ve el grafo de memorias, y por qué.
//
// El modelo está copiado de Obsidian a propósito, después de verificar qué hace de verdad
// (obsidian.md/help/plugins/graph, 2026-09-11). Las cuatro cosas que le tomamos prestadas,
// cada una resolviendo un problema concreto que este grafo tenía con datos reales:
//
// 1. **El filtro de huérfanas** (Obsidian: "Orphans — toggles whether to show notes without
//    any links"). Medido con la base real del usuario: de ~200 memorias, casi ninguna tiene
//    `topic_key` ni rama compartida, así que el grafo era una nube de puntos sin una sola
//    línea. Acá va **apagado por default**, al revés que Obsidian, porque en Obsidian las
//    notas se enlazan a mano y acá las relaciones se infieren: lo normal es tener muchas
//    sueltas.
// 2. **Los grupos son color** (Obsidian: un grupo por consulta de búsqueda). Nuestro
//    equivalente natural es un grupo por PROYECTO, armado solo.
// 3. **El tamaño del nodo escala con las conexiones** ("the more nodes that reference a
//    given node, the bigger it gets"). Antes el tamaño sólo decía si estaba reemplazada,
//    que es casi nada.
// 4. **Las aristas se distinguen por forma**, no por color — eso no es de Obsidian, es
//    nuestro: `revision` es dirigida (el linaje de una idea), `topic` y `branch` son
//    agrupamientos, y `similar` es inferencia, no un hecho afirmado. Mezclar las cuatro en
//    la misma línea gris es lo que hace que un grafo se vea rico y no signifique nada.
//
// El color de los NODOS sí es categórico (proyecto o tipo): es la excepción justificada a
// la regla de que el color es estado, la misma que ya usa `memory-type-legend.ts`.
import type { MemoryEdgeKind, MemoryGraph, MemoryGraphNode } from '../types'
import { memoryTypeSwatch } from './memory-type-legend'

export type ColorBy = 'project' | 'type' | 'tag'

/** Nodo tal como lo consume react-force-graph-3d. `id` es el `syncId`. */
export interface GraphNodeDatum {
  id: string
  label: string
  color: string
  /** Área relativa del nodo: crece con la cantidad de conexiones, como en Obsidian. */
  val: number
  /** Cuántas aristas tocan este nodo. 0 = huérfana. */
  degree: number
  superseded: boolean
  type: string
  projectKey: string
  /** Nombre legible; cae al `projectKey` (un hash) sólo si el proyecto nunca se registró. */
  projectLabel: string
  tags: string[]
  gitBranch: string | null
}

export interface GraphLinkDatum {
  source: string
  target: string
  kind: MemoryEdgeKind
}

export interface GraphData {
  nodes: GraphNodeDatum[]
  links: GraphLinkDatum[]
  /** Cuántas quedaron afuera por el filtro de huérfanas. Se muestra: esconder la mitad de
   *  las memorias sin decirlo es mentir sobre lo que hay. */
  orphansHidden: number
}

/** Gris neutro para un tipo fuera de la leyenda fija — nunca un color inventado. */
const NEUTRAL_NODE = '#8a8a8a'

/**
 * Paleta categórica para los proyectos. Los primeros siete son los mismos de
 * `memory-type-legend.ts` (tema validado por contraste >=3:1 contra `--card`, y ordenado
 * para seguridad CVD); los cinco extra siguen el mismo criterio y extienden la rueda.
 *
 * Se asigna por POSICIÓN en la lista ordenada de proyectos, no por hash: un hash da colores
 * estables pero puede repetir dos veces el mismo entre proyectos vecinos, que es justo lo
 * que un grupo de color no puede hacer. Con la lista ordenada alfabéticamente, el color de
 * un proyecto sólo cambia si aparece o desaparece otro — y sigue siendo estable entre
 * sesiones.
 */
const PROJECT_PALETTE = [
  '#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300',
  '#9085e9', '#0e8f8f', '#b4553d', '#6f8f1e', '#c2408a', '#4a76d4',
]

/** Proyecto -> color, estable para un mismo conjunto de proyectos. */
export function projectColors(projectKeys: string[]): Map<string, string> {
  const ordenados = [...new Set(projectKeys)].sort()
  const out = new Map<string, string>()
  ordenados.forEach((k, i) => out.set(k, PROJECT_PALETTE[i % PROJECT_PALETTE.length]))
  return out
}

/**
 * Cuántas memorias tiene cada tag, de mayor a menor. El orden importa y no es cosmético:
 * es lo que resuelve que una memoria pueda tener VARIOS tags.
 *
 * Obsidian tiene el mismo problema —una nota puede caer en varios grupos— y lo resuelve por
 * ORDEN: gana el primer grupo que matchea. Acá el orden es la frecuencia, que es el criterio
 * que hace que el color diga lo máximo posible: el tag más usado es el que más separa el
 * corpus en dos.
 */
export function tagRanking(nodes: Array<{ tags: string[] }>): string[] {
  const cuenta = new Map<string, number>()
  for (const n of nodes) for (const t of n.tags) cuenta.set(t, (cuenta.get(t) ?? 0) + 1)
  return [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t)
}

/** Tag -> color, por posición en el ranking. Estable mientras el ranking no cambie. */
export function tagColors(ranking: string[]): Map<string, string> {
  const out = new Map<string, string>()
  ranking.forEach((t, i) => out.set(t, PROJECT_PALETTE[i % PROJECT_PALETTE.length]))
  return out
}

/** El tag que le da el color a una memoria: el más arriba del ranking que tenga. `null` si
 *  no tiene ninguno — ahí va gris, no un color inventado. */
export function tagDominante(tags: string[], ranking: string[]): string | null {
  for (const t of ranking) if (tags.includes(t)) return t
  return null
}

export interface EdgeStyle {
  width: number
  color: string
  curvature: number
  /** Largo de la punta de flecha; 0 = sin flecha. Sólo `revision` la tiene. */
  arrowLength: number
  label: string
  /** Qué afirma esta arista. La diferencia entre un hecho y una inferencia tiene que estar
   *  escrita, no sólo dibujada. */
  meaning: string
}

export const EDGE_STYLES: Record<MemoryEdgeKind, EdgeStyle> = {
  // La más marcada de todas, y a propósito: las otras seis las infiere el sistema de algún
  // campo compartido; ésta es la única que una persona afirmó. Si se dibujara como las demás,
  // lo único que alguien se tomó el trabajo de decir quedaría indistinguible de lo que dedujo
  // una consulta SQL.
  manual: {
    width: 2.4,
    color: 'rgba(255, 255, 255, 0.95)',
    curvature: 0,
    arrowLength: 0,
    label: 'Connected by hand',
    meaning: 'Someone said these two go together',
  },
  revision: {
    width: 2,
    color: 'rgba(232, 232, 232, 0.85)',
    curvature: 0,
    arrowLength: 3.5,
    label: 'Revision',
    meaning: 'This memory replaced that one',
  },
  topic: {
    width: 1.2,
    color: 'rgba(180, 180, 180, 0.5)',
    curvature: 0.25,
    arrowLength: 0,
    label: 'Same topic',
    meaning: 'Saved under the same topic',
  },
  branch: {
    width: 1.2,
    color: 'rgba(140, 140, 140, 0.38)',
    curvature: -0.25,
    arrowLength: 0,
    label: 'Same branch',
    meaning: 'Written while working on the same branch',
  },
  // De dónde salió. Es la única relación que tienen las memorias IMPORTADAS: el importador
  // le da a cada chunk su propio topic_key y no le pone rama ni tags, así que sin esta
  // arista una memoria importada no puede conectarse con nada. Es un hecho declarado
  // (`source_ref`), no una inferencia — por eso va con las otras tres y no con `similar`.
  source: {
    width: 1,
    color: 'rgba(160, 160, 160, 0.42)',
    curvature: 0.12,
    arrowLength: 0,
    label: 'Same document',
    meaning: 'Imported from the same file',
  },
  // La unica arista de hecho que CRUZA proyectos: el mismo topic en dos repos. Va marcada
  // --la mas ancha despues de `revision`, y curvada al reves que las demas-- porque es la
  // que cuenta algo que ninguna vista de un solo proyecto puede mostrar: que hay trabajo
  // sobre el mismo tema en los dos lados. Ademas se reconoce sola, porque es la unica que
  // une dos nodos de COLOR distinto cuando el grafo se colorea por proyecto.
  'cross-topic': {
    width: 1.6,
    color: 'rgba(210, 210, 210, 0.6)',
    curvature: -0.4,
    arrowLength: 0,
    label: 'Same topic, other repo',
    meaning: 'The same topic worked on in more than one project',
  },
  similar: {
    width: 0.6,
    color: 'rgba(120, 120, 120, 0.22)',
    curvature: 0.5,
    arrowLength: 0,
    label: 'Similar',
    meaning: 'Guessed from shared tags — not something anyone stated',
  },
}

export const EDGE_KINDS_IN_LEGEND_ORDER: MemoryEdgeKind[] = ['manual', 'revision', 'topic', 'cross-topic', 'branch', 'source', 'similar']

function nodeLabel(node: MemoryGraphNode): string {
  return node.title.trim() || '(untitled)'
}

/**
 * Tamaño del nodo a partir de su grado. Raíz cuadrada, no lineal: con el área proporcional
 * al grado, un nodo con 20 conexiones se comería la pantalla. Es el mismo criterio que usa
 * cualquier scatter honesto — el AREA representa la magnitud, no el radio.
 */
function valorPorGrado(degree: number, superseded: boolean): number {
  const base = 1.5 + Math.sqrt(degree) * 1.6
  // Una memoria reemplazada sigue en el linaje pero ya no es la vigente: se dibuja mas
  // chica para que la version viva sea la que se lee primero.
  return superseded ? base * 0.55 : base
}

/** En qué está enfocado el grafo: un proyecto, un tag, o nada. Es el "abrir uno" de
 *  Obsidian, generalizado — un tag agrupa igual de bien que una carpeta. */
export type Foco = { tipo: 'project'; valor: string } | { tipo: 'tag'; valor: string } | null

export interface ToGraphDataOptions {
  /** Qué significa el color de un nodo. */
  colorBy: ColorBy
  /** Esconder las memorias sin ninguna conexión (el filtro "Orphans" de Obsidian). */
  hideOrphans: boolean
  foco: Foco
}

/**
 * Traduce el grafo del store al formato del render.
 *
 * Una cosa que hace y es fácil de perder: **descarta las aristas con una punta que no vino
 * en el grafo**. El store trunca por `limit`, así que puede devolver una arista hacia un
 * nodo ausente — y react-force-graph, si la recibe, INVENTA ese nodo: aparece un punto sin
 * título, sin color y sin tipo, que no corresponde a ninguna memoria.
 */
export function toGraphData(graph: MemoryGraph, opts: ToGraphDataOptions): GraphData {
  const enFoco = !opts.foco
    ? graph.nodes
    : opts.foco.tipo === 'project'
      ? graph.nodes.filter((n) => n.projectKey === opts.foco!.valor)
      : graph.nodes.filter((n) => n.tags.includes(opts.foco!.valor))

  const idsEnFoco = new Set(enFoco.map((n) => n.syncId))
  const aristas = graph.edges.filter((e) => idsEnFoco.has(e.from) && idsEnFoco.has(e.to))

  // El grado se cuenta sobre las aristas que de verdad se van a dibujar, no sobre las que
  // el store devolvio: si filtramos por proyecto, una memoria puede quedar huerfana ACA
  // aunque tenga vecinos en otro proyecto.
  const grado = new Map<string, number>()
  for (const e of aristas) {
    grado.set(e.from, (grado.get(e.from) ?? 0) + 1)
    grado.set(e.to, (grado.get(e.to) ?? 0) + 1)
  }

  const colores = projectColors(enFoco.map((n) => n.projectKey))
  const ranking = opts.colorBy === 'tag' ? tagRanking(enFoco) : []
  const coloresDeTag = tagColors(ranking)

  const todos: GraphNodeDatum[] = enFoco.map((n) => {
    const degree = grado.get(n.syncId) ?? 0
    const colorPorTag = () => {
      const dom = tagDominante(n.tags, ranking)
      return dom ? (coloresDeTag.get(dom) ?? NEUTRAL_NODE) : NEUTRAL_NODE
    }
    return {
      id: n.syncId,
      label: nodeLabel(n),
      color: opts.colorBy === 'project'
        ? (colores.get(n.projectKey) ?? NEUTRAL_NODE)
        : opts.colorBy === 'tag'
          ? colorPorTag()
          : (memoryTypeSwatch(n.type)?.color ?? NEUTRAL_NODE),
      val: valorPorGrado(degree, n.superseded),
      degree,
      superseded: n.superseded,
      type: n.type,
      projectKey: n.projectKey,
      projectLabel: n.projectDisplayName ?? n.projectKey,
      tags: n.tags,
      gitBranch: n.gitBranch,
    }
  })

  const nodes = opts.hideOrphans ? todos.filter((n) => n.degree > 0) : todos
  const visibles = new Set(nodes.map((n) => n.id))

  return {
    nodes,
    links: aristas
      .filter((e) => visibles.has(e.from) && visibles.has(e.to))
      .map((e) => ({ source: e.from, target: e.to, kind: e.kind })),
    orphansHidden: todos.length - nodes.length,
  }
}

export interface ProjectGroup {
  projectKey: string
  /** Lo que se muestra. `projectKey` es un hash: una lista de proyectos que muestre la
   *  clave cruda le pone al usuario "78b30bb38a968148" donde esperaba el nombre del repo. */
  label: string
  color: string
  count: number
}

/** Los grupos para la leyenda: un proyecto, su color y cuántas memorias tiene. Ordenados
 *  por cantidad, que es el orden en que a alguien le importan. */
export function projectGroups(graph: MemoryGraph): ProjectGroup[] {
  const colores = projectColors(graph.nodes.map((n) => n.projectKey))
  const cuenta = new Map<string, number>()
  const etiquetas = new Map<string, string>()
  for (const n of graph.nodes) {
    cuenta.set(n.projectKey, (cuenta.get(n.projectKey) ?? 0) + 1)
    if (n.projectDisplayName) etiquetas.set(n.projectKey, n.projectDisplayName)
  }
  return [...cuenta.entries()]
    .map(([projectKey, count]) => ({
      projectKey,
      label: etiquetas.get(projectKey) ?? projectKey,
      color: colores.get(projectKey) ?? NEUTRAL_NODE,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export interface TagGroup {
  tag: string
  color: string
  count: number
}

/** Los tags para la leyenda: cuál es, su color y cuántas memorias lo llevan. El orden es el
 *  del ranking, o sea por cantidad — el mismo que decide el color de una memoria con varios. */
export function tagGroups(graph: MemoryGraph): TagGroup[] {
  const ranking = tagRanking(graph.nodes)
  const colores = tagColors(ranking)
  const cuenta = new Map<string, number>()
  for (const n of graph.nodes) for (const t of n.tags) cuenta.set(t, (cuenta.get(t) ?? 0) + 1)
  return ranking.map((tag) => ({ tag, color: colores.get(tag) ?? NEUTRAL_NODE, count: cuenta.get(tag) ?? 0 }))
}

/** Cuántas aristas de cada tipo hay. La leyenda no lista un tipo que no está en pantalla. */
export function countEdgeKinds(data: GraphData): Record<MemoryEdgeKind, number> {
  const out: Record<MemoryEdgeKind, number> = {
    manual: 0, revision: 0, topic: 0, 'cross-topic': 0, branch: 0, source: 0, similar: 0,
  }
  for (const l of data.links) out[l.kind] += 1
  return out
}
