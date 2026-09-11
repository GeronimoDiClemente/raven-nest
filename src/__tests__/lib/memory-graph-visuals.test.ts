// La capa que decide qué significa cada cosa en el grafo, testeada sin montar WebGL.
import { describe, it, expect } from 'vitest'
import {
  toGraphData,
  countEdgeKinds,
  EDGE_STYLES,
  EDGE_KINDS_IN_LEGEND_ORDER,
} from '../../lib/memory-graph-visuals'
import { memoryTypeSwatch } from '../../lib/memory-type-legend'
import type { MemoryGraph, MemoryGraphNode, MemoryEdgeKind } from '../../types'

function nodo(syncId: string, extra: Partial<MemoryGraphNode> = {}): MemoryGraphNode {
  return {
    syncId,
    title: `titulo de ${syncId}`,
    type: 'decision',
    scope: 'project',
    topicKey: null,
    gitBranch: null,
    originAi: null,
    authorDisplay: null,
    updatedAt: 1_700_000_000_000,
    superseded: false,
    ...extra,
  }
}

function grafo(nodes: MemoryGraphNode[], edges: MemoryGraph['edges'] = []): MemoryGraph {
  return { nodes, edges, truncated: 0 }
}

describe('toGraphData', () => {
  it('le da a cada nodo el color de su tipo, el mismo que el punto de la lista', () => {
    const data = toGraphData(grafo([nodo('a', { type: 'bugfix' })]))
    expect(data.nodes[0].color).toBe(memoryTypeSwatch('bugfix')!.color)
  })

  it('un tipo fuera de la leyenda cae a un gris neutro, no a un color inventado', () => {
    const data = toGraphData(grafo([nodo('a', { type: 'handoff' })]))
    // El mismo criterio que memoryTypeSwatch, que devuelve null para estos.
    expect(memoryTypeSwatch('handoff')).toBeNull()
    expect(data.nodes[0].color).toBe('#8a8a8a')
  })

  it('dibuja mas chica una memoria reemplazada: sigue en el linaje pero no es la vigente', () => {
    const data = toGraphData(grafo([nodo('viva'), nodo('vieja', { superseded: true })]))
    const viva = data.nodes.find((n) => n.id === 'viva')!
    const vieja = data.nodes.find((n) => n.id === 'vieja')!
    expect(vieja.val).toBeLessThan(viva.val)
  })

  it('un titulo vacio no deja el nodo sin etiqueta', () => {
    const data = toGraphData(grafo([nodo('a', { title: '   ' })]))
    expect(data.nodes[0].label).toBe('(untitled)')
  })

  // El caso que importa: el store trunca por `limit`, asi que puede devolver una arista
  // hacia un nodo que no vino. react-force-graph, si la recibe, INVENTA ese nodo — aparece
  // un punto sin titulo, sin color y sin tipo, que no corresponde a ninguna memoria.
  it('descarta las aristas que apuntan a un nodo que no vino en el grafo', () => {
    const data = toGraphData(grafo(
      [nodo('a'), nodo('b')],
      [
        { from: 'a', to: 'b', kind: 'topic', directed: false },
        { from: 'a', to: 'fantasma', kind: 'topic', directed: false },
        { from: 'fantasma', to: 'b', kind: 'revision', directed: true },
      ],
    ))
    expect(data.links).toHaveLength(1)
    expect(data.links[0]).toEqual({ source: 'a', target: 'b', kind: 'topic' })
    // Y sobre todo: no se colo ningun nodo que el store no haya devuelto.
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })

  it('no filtra las aristas similar: eso lo decide la query, no el render', () => {
    const data = toGraphData(grafo(
      [nodo('a'), nodo('b')],
      [{ from: 'a', to: 'b', kind: 'similar', directed: false }],
    ))
    expect(data.links).toHaveLength(1)
  })
})

describe('EDGE_STYLES', () => {
  it('solo revision es dirigida — es la unica que cuenta una historia', () => {
    const conFlecha = EDGE_KINDS_IN_LEGEND_ORDER.filter((k) => EDGE_STYLES[k].arrowLength > 0)
    expect(conFlecha).toEqual(['revision'])
  })

  it('similar es la mas tenue y la mas fina: es inferencia, no un hecho afirmado', () => {
    const otras: MemoryEdgeKind[] = ['revision', 'topic', 'branch']
    for (const k of otras) {
      expect(EDGE_STYLES.similar.width).toBeLessThan(EDGE_STYLES[k].width)
    }
    // Y lo dice, ademas de dibujarlo: la diferencia entre un hecho y una inferencia tiene
    // que estar escrita.
    expect(EDGE_STYLES.similar.meaning).toMatch(/not something anyone stated/)
  })

  it('los cuatro tipos se distinguen por forma, no por color', () => {
    // Ninguno repite la combinacion ancho+curvatura+flecha de otro. Si dos quedaran
    // iguales, el grafo se veria rico y no significaria nada — que es exactamente lo que
    // la spec pide evitar.
    const formas = EDGE_KINDS_IN_LEGEND_ORDER.map((k) => {
      const s = EDGE_STYLES[k]
      return `${s.width}|${s.curvature}|${s.arrowLength}`
    })
    expect(new Set(formas).size).toBe(formas.length)
  })
})

describe('countEdgeKinds', () => {
  it('cuenta por tipo y devuelve cero para los que no estan, no undefined', () => {
    const data = toGraphData(grafo(
      [nodo('a'), nodo('b'), nodo('c')],
      [
        { from: 'a', to: 'b', kind: 'topic', directed: false },
        { from: 'b', to: 'c', kind: 'topic', directed: false },
        { from: 'a', to: 'c', kind: 'revision', directed: true },
      ],
    ))
    expect(countEdgeKinds(data)).toEqual({ revision: 1, topic: 2, branch: 0, similar: 0 })
  })
})
