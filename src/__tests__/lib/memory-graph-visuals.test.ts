// La capa que decide qué significa cada cosa en el grafo, testeada sin montar WebGL.
import { describe, it, expect } from 'vitest'
import {
  toGraphData,
  countEdgeKinds,
  projectColors,
  projectGroups,
  tagGroups,
  tagRanking,
  tagDominante,
  EDGE_STYLES,
  EDGE_KINDS_IN_LEGEND_ORDER,
  type ToGraphDataOptions,
} from '../../lib/memory-graph-visuals'

import { memoryTypeSwatch } from '../../lib/memory-type-legend'
import type { MemoryGraph, MemoryGraphNode, MemoryEdgeKind } from '../../types'

/** Lo que miraban los tests originales: todo visible, sin enfocar, color por tipo. El
 *  filtro de huerfanas y el enfoque por proyecto tienen sus propios casos mas abajo. */
const TODO: ToGraphDataOptions = { colorBy: 'type', hideOrphans: false, foco: null }

function nodo(syncId: string, extra: Partial<MemoryGraphNode> = {}): MemoryGraphNode {
  return {
    syncId,
    projectKey: 'proyecto-a',
    projectDisplayName: null,
    tags: [],
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
    const data = toGraphData(grafo([nodo('a', { type: 'bugfix' })]), TODO)
    expect(data.nodes[0].color).toBe(memoryTypeSwatch('bugfix')!.color)
  })

  it('un tipo fuera de la leyenda cae a un gris neutro, no a un color inventado', () => {
    const data = toGraphData(grafo([nodo('a', { type: 'handoff' })]), TODO)
    // El mismo criterio que memoryTypeSwatch, que devuelve null para estos.
    expect(memoryTypeSwatch('handoff')).toBeNull()
    expect(data.nodes[0].color).toBe('#8a8a8a')
  })

  it('dibuja mas chica una memoria reemplazada: sigue en el linaje pero no es la vigente', () => {
    const data = toGraphData(grafo([nodo('viva'), nodo('vieja', { superseded: true })]), TODO)
    const viva = data.nodes.find((n) => n.id === 'viva')!
    const vieja = data.nodes.find((n) => n.id === 'vieja')!
    expect(vieja.val).toBeLessThan(viva.val)
  })

  it('un titulo vacio no deja el nodo sin etiqueta', () => {
    const data = toGraphData(grafo([nodo('a', { title: '   ' })]), TODO)
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
    ), TODO)
    expect(data.links).toHaveLength(1)
    expect(data.links[0]).toEqual({ source: 'a', target: 'b', kind: 'topic' })
    // Y sobre todo: no se colo ningun nodo que el store no haya devuelto.
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })

  it('no filtra las aristas similar: eso lo decide la query, no el render', () => {
    const data = toGraphData(grafo(
      [nodo('a'), nodo('b')],
      [{ from: 'a', to: 'b', kind: 'similar', directed: false }],
    ), TODO)
    expect(data.links).toHaveLength(1)
  })
})

describe('EDGE_STYLES', () => {
  it('solo revision es dirigida — es la unica que cuenta una historia', () => {
    const conFlecha = EDGE_KINDS_IN_LEGEND_ORDER.filter((k) => EDGE_STYLES[k].arrowLength > 0)
    expect(conFlecha).toEqual(['revision'])
  })

  it('similar es la mas tenue y la mas fina: es inferencia, no un hecho afirmado', () => {
    const otras: MemoryEdgeKind[] = ['revision', 'topic', 'branch', 'source', 'cross-topic']
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
    ), TODO)
    expect(countEdgeKinds(data)).toEqual({ manual: 0, revision: 1, topic: 2, 'cross-topic': 0, branch: 0, source: 0, similar: 0 })
  })
})

// Lo que hace legible un grafo grande, copiado de Obsidian despues de verificar que hace
// (obsidian.md/help/plugins/graph): esconder las huerfanas, agrupar por color, y que el
// tamano del nodo diga cuantas conexiones tiene.
describe('el filtro de huerfanas — el "Orphans" de Obsidian', () => {
  const conUnaSuelta = grafo(
    [nodo('a'), nodo('b'), nodo('suelta')],
    [{ from: 'a', to: 'b', kind: 'topic', directed: false }],
  )

  it('esconde las memorias sin ninguna conexion y dice cuantas escondio', () => {
    const data = toGraphData(conUnaSuelta, { ...TODO, hideOrphans: true })
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    // Decir cuantas esconde no es un detalle: un grafo que oculta la mitad de las memorias
    // sin avisar miente sobre lo que hay.
    expect(data.orphansHidden).toBe(1)
  })

  it('apagado, no esconde nada y el contador queda en cero', () => {
    const data = toGraphData(conUnaSuelta, { ...TODO, hideOrphans: false })
    expect(data.nodes).toHaveLength(3)
    expect(data.orphansHidden).toBe(0)
  })
})

describe('enfocar un proyecto', () => {
  const dosProyectos = grafo(
    [
      nodo('a1', { projectKey: 'uno' }),
      nodo('a2', { projectKey: 'uno' }),
      nodo('b1', { projectKey: 'dos' }),
    ],
    [
      { from: 'a1', to: 'a2', kind: 'topic', directed: false },
      // Una arista que CRUZA proyectos: al enfocar uno, tiene que desaparecer.
      { from: 'a2', to: 'b1', kind: 'branch', directed: false },
    ],
  )

  it('deja solo las memorias de ese proyecto', () => {
    const data = toGraphData(dosProyectos, { ...TODO, foco: { tipo: 'project', valor: 'uno' } })
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['a1', 'a2'])
  })

  it('descarta las aristas que salen del proyecto enfocado', () => {
    const data = toGraphData(dosProyectos, { ...TODO, foco: { tipo: 'project', valor: 'uno' } })
    expect(data.links).toHaveLength(1)
    expect(data.links[0].kind).toBe('topic')
  })

  // El caso sutil: el grado se cuenta sobre lo que se VA A DIBUJAR. Si no, una memoria cuyo
  // unico vecino esta en otro proyecto se veria conectada estando sola.
  it('una memoria cuyo unico vecino quedo afuera cuenta como huerfana', () => {
    const soloCruzada = grafo(
      [nodo('a', { projectKey: 'uno' }), nodo('b', { projectKey: 'dos' })],
      [{ from: 'a', to: 'b', kind: 'branch', directed: false }],
    )
    const data = toGraphData(soloCruzada, { ...TODO, foco: { tipo: 'project', valor: 'uno' }, hideOrphans: true })
    expect(data.nodes).toHaveLength(0)
    expect(data.orphansHidden).toBe(1)
  })
})

describe('el tamano del nodo', () => {
  it('crece con la cantidad de conexiones, como en Obsidian', () => {
    const data = toGraphData(grafo(
      [nodo('centro'), nodo('a'), nodo('b'), nodo('c')],
      [
        { from: 'centro', to: 'a', kind: 'topic', directed: false },
        { from: 'centro', to: 'b', kind: 'topic', directed: false },
        { from: 'centro', to: 'c', kind: 'topic', directed: false },
      ],
    ), TODO)
    const centro = data.nodes.find((n) => n.id === 'centro')!
    const hoja = data.nodes.find((n) => n.id === 'a')!
    expect(centro.degree).toBe(3)
    expect(hoja.degree).toBe(1)
    expect(centro.val).toBeGreaterThan(hoja.val)
  })

  // Raiz cuadrada, no lineal: con el area proporcional al grado, un nodo con 20 conexiones
  // se comeria la pantalla.
  it('crece sublinealmente: 9 conexiones no es 9 veces 1 conexion', () => {
    const conGrado = (n: number) => {
      const vecinos = Array.from({ length: n }, (_, i) => nodo(`v${i}`))
      const aristas = vecinos.map((v) => ({ from: 'centro', to: v.syncId, kind: 'topic' as const, directed: false }))
      const data = toGraphData(grafo([nodo('centro'), ...vecinos], aristas), TODO)
      return data.nodes.find((x) => x.id === 'centro')!.val
    }
    expect(conGrado(9) / conGrado(1)).toBeLessThan(3)
  })
})

describe('los grupos por proyecto', () => {
  it('le da a cada proyecto un color distinto', () => {
    const colores = projectColors(['alfa', 'beta', 'gamma'])
    expect(new Set(colores.values()).size).toBe(3)
  })

  // Estable, no aleatorio: el color de un proyecto no puede cambiar entre sesiones.
  it('el mismo conjunto de proyectos da siempre los mismos colores, sin importar el orden', () => {
    const a = projectColors(['gamma', 'alfa', 'beta'])
    const b = projectColors(['alfa', 'beta', 'gamma'])
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort())
  })

  it('lista los proyectos con su cuenta, del que mas memorias tiene al que menos', () => {
    const grupos = projectGroups(grafo([
      nodo('a', { projectKey: 'chico' }),
      nodo('b', { projectKey: 'grande' }),
      nodo('c', { projectKey: 'grande' }),
      nodo('d', { projectKey: 'grande' }),
    ]))
    expect(grupos.map((g) => [g.projectKey, g.count])).toEqual([['grande', 3], ['chico', 1]])
  })
})

describe('el nombre del proyecto', () => {
  // El `project_key` es un hash (resolveProjectKey). Con datos reales la lista de proyectos
  // mostraba "78b30bb38a968148" en vez del nombre del repo, porque el grafo nunca buscaba
  // el display_name.
  it('usa el nombre legible cuando existe', () => {
    const grupos = projectGroups(grafo([
      nodo('a', { projectKey: '78b30bb38a968148', projectDisplayName: 'raven-nest' }),
    ]))
    expect(grupos[0].label).toBe('raven-nest')
  })

  it('cae a la clave solo si el proyecto nunca se registro', () => {
    const grupos = projectGroups(grafo([
      nodo('a', { projectKey: '78b30bb38a968148', projectDisplayName: null }),
    ]))
    expect(grupos[0].label).toBe('78b30bb38a968148')
  })

  it('ordena por cantidad y desempata por NOMBRE, no por el hash', () => {
    const grupos = projectGroups(grafo([
      nodo('a', { projectKey: 'zzz', projectDisplayName: 'alfa' }),
      nodo('b', { projectKey: 'aaa', projectDisplayName: 'beta' }),
    ]))
    expect(grupos.map((g) => g.label)).toEqual(['alfa', 'beta'])
  })
})

// Agrupar por TAG — el Group mas fiel de Obsidian de los tres, porque alla un grupo es una
// consulta y no un campo. El problema propio de los tags es que una memoria puede tener
// VARIOS, asi que hay que decidir cual le da el color.
describe('agrupar por tag', () => {
  it('rankea los tags por cantidad, de mayor a menor', () => {
    const ranking = tagRanking([
      { tags: ['auth', 'api'] },
      { tags: ['auth'] },
      { tags: ['api'] },
      { tags: ['auth'] },
    ])
    expect(ranking).toEqual(['auth', 'api'])
  })

  it('desempata alfabeticamente, para que el color no dependa del orden de las filas', () => {
    expect(tagRanking([{ tags: ['zeta'] }, { tags: ['alfa'] }])).toEqual(['alfa', 'zeta'])
  })

  // Obsidian resuelve la pertenencia multiple por ORDEN: gana el primer grupo que matchea.
  // Aca el orden es la frecuencia, que es lo que hace que el color separe lo mas posible.
  it('una memoria con varios tags toma el color del mas usado del corpus', () => {
    const ranking = ['auth', 'api']
    expect(tagDominante(['api', 'auth'], ranking)).toBe('auth')
    expect(tagDominante(['api'], ranking)).toBe('api')
  })

  it('una memoria sin tags no toma ningun color de tag', () => {
    expect(tagDominante([], ['auth'])).toBeNull()
  })

  it('los grupos traen tag, color y cuenta, ordenados por cantidad', () => {
    const grupos = tagGroups(grafo([
      nodo('a', { tags: ['auth', 'api'] }),
      nodo('b', { tags: ['auth'] }),
      nodo('c', { tags: ['api'] }),
      nodo('d', { tags: ['auth'] }),
    ]))
    expect(grupos.map((g) => [g.tag, g.count])).toEqual([['auth', 3], ['api', 2]])
    expect(new Set(grupos.map((g) => g.color)).size).toBe(2)
  })

  it('colorear por tag le da colores distintos a tags distintos', () => {
    const data = toGraphData(grafo([
      nodo('a', { tags: ['auth'] }),
      nodo('b', { tags: ['api'] }),
    ]), { ...TODO, colorBy: 'tag' })
    expect(new Set(data.nodes.map((n) => n.color)).size).toBe(2)
  })
})

describe('enfocar un tag', () => {
  const conTags = grafo([
    nodo('a', { tags: ['auth'] }),
    nodo('b', { tags: ['auth', 'api'] }),
    nodo('c', { tags: ['otro'] }),
  ])

  it('deja solo las memorias que lo llevan', () => {
    const data = toGraphData(conTags, { ...TODO, foco: { tipo: 'tag', valor: 'auth' } })
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })

  // Un tag CRUZA proyectos por naturaleza, al reves que una carpeta: esa es justamente la
  // gracia de tenerlo como agrupador aparte del proyecto.
  it('cruza proyectos, al reves que enfocar un proyecto', () => {
    const data = toGraphData(grafo([
      nodo('a', { projectKey: 'uno', tags: ['auth'] }),
      nodo('b', { projectKey: 'dos', tags: ['auth'] }),
    ]), { ...TODO, foco: { tipo: 'tag', valor: 'auth' } })
    expect(data.nodes).toHaveLength(2)
    expect(new Set(data.nodes.map((n) => n.projectKey)).size).toBe(2)
  })
})
