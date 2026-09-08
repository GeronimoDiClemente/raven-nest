// Ramas -> nodos, aristas y COORDENADAS. Puro y deterministico, para que el layout se
// testee con vectores fijos en vez de snapshots de pixeles (spec §7.4).
//
// Vive en src/ y no en electron/ porque es puramente presentacional: el proceso main nunca
// construye un grafo. Y src/ nunca importa de electron/ (ver src/types.ts).
//
// Sin librerias de grafos: no hay ninguna en package.json y no se agrega. Radial por
// anillos alcanza para el tamano que esta feature tiene por diseno.
import type { TeamThreadBranch, TeamThreadEstado } from '../types'

/** Arriba de esto la evidencia es unanime: se convierte en una bola de pelo (spec §7.3). */
export const GRAPH_NODE_CAP = 200

const RADIO_ANILLO = 120
const NODOS_POR_ANILLO = 12

export type Frescura = 'hoy' | 'semana' | 'mes' | 'viejo'

export interface GraphNode {
  id: string
  label: string
  estado: TeamThreadEstado
  frescura: Frescura
  autor: string
  x: number
  y: number
  foco: boolean
}

export interface GraphEdge {
  from: string
  to: string
}

export interface ThreadGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  recortados: number
}

export interface BuildGraphInput {
  branches: TeamThreadBranch[]
  /** Slug de la rama del worktree actual, o null. */
  focus: string | null
  ahora: number
  /** false = grafo local (foco + vecinos), que es el default (spec §7.3). */
  global: boolean
}

function frescuraDe(ultimaEntrada: number, ahora: number): Frescura {
  const dias = (ahora - ultimaEntrada) / 86400_000
  if (dias < 1) return 'hoy'
  if (dias < 7) return 'semana'
  if (dias < 30) return 'mes'
  return 'viejo'
}

export function buildThreadGraph(input: BuildGraphInput): ThreadGraph {
  const { branches, focus, ahora, global } = input

  const visibles = global ? branches : branches.filter((b) => b.slug === focus)

  // Recorte por recencia: sobrevive lo mas nuevo, que es lo que alguien necesita para
  // ponerse al dia.
  const ordenadas = [...visibles].sort((a, b) => b.ultimaEntrada - a.ultimaEntrada)
  const dentro = ordenadas.slice(0, GRAPH_NODE_CAP)
  const recortados = ordenadas.length - dentro.length

  const nodes: GraphNode[] = [
    { id: '_index', label: 'índice', estado: 'activa', frescura: 'hoy', autor: '', x: 0, y: 0, foco: false },
  ]
  const edges: GraphEdge[] = []

  dentro.forEach((b, i) => {
    const anillo = Math.floor(i / NODOS_POR_ANILLO) + 1
    const enAnillo = i % NODOS_POR_ANILLO
    const angulo = (enAnillo / NODOS_POR_ANILLO) * Math.PI * 2
    nodes.push({
      id: b.slug,
      label: b.branch,
      estado: b.estado,
      frescura: frescuraDe(b.ultimaEntrada, ahora),
      autor: b.ultimoAutor,
      // Redondeado: coordenadas exactas para que el test de vector fijo no dependa de
      // como imprime floats esta version de Node.
      x: Math.round(Math.cos(angulo) * RADIO_ANILLO * anillo),
      y: Math.round(Math.sin(angulo) * RADIO_ANILLO * anillo),
      foco: b.slug === focus,
    })
    edges.push({ from: '_index', to: b.slug })
  })

  return { nodes, edges, recortados }
}
