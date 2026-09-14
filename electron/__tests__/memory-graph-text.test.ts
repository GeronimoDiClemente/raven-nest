// El grafo dibujado para una terminal.
//
// Lo que se prueba acá no es que el ASCII sea bonito, sino que SIGNIFIQUE lo mismo que la
// versión 3D: que una memoria reemplazada se distinga de una vigente, que la arista que
// cruza repos se distinga de las que no, y que nada se dibuje envolviendo una línea — una
// fila que envuelve rompe el árbol y lo vuelve ilegible.
import { describe, it, expect } from 'vitest'
import { renderMemoryGraphText } from '../memory-graph-text'
import type { MemoryGraph, MemoryGraphNode } from '../memory-graph'

const AHORA = 1_757_000_000_000

function nodo(syncId: string, extra: Partial<MemoryGraphNode> = {}): MemoryGraphNode {
  return {
    syncId,
    projectKey: 'raven-nest',
    projectDisplayName: 'raven-nest',
    tags: [],
    title: `titulo de ${syncId}`,
    type: 'decision',
    scope: 'project',
    topicKey: null,
    gitBranch: null,
    originAi: null,
    authorDisplay: null,
    updatedAt: AHORA - 3600_000,
    superseded: false,
    ...extra,
  }
}

function grafo(nodes: MemoryGraphNode[], edges: MemoryGraph['edges'] = []): MemoryGraph {
  return { nodes, edges, truncated: 0 }
}

describe('renderMemoryGraphText', () => {
  it('sin memorias lo dice, no devuelve un dibujo vacio', () => {
    expect(renderMemoryGraphText(grafo([]), {}, AHORA)).toMatch(/No memories yet/)
  })

  it('con un filtro que no matchea, lo dice con el filtro puesto', () => {
    const out = renderMemoryGraphText(grafo([]), { encabezado: '#auth' }, AHORA)
    expect(out).toContain('#auth')
    expect(out).toMatch(/No hay memorias que coincidan/)
  })

  it('el encabezado cuenta memorias y proyectos', () => {
    const out = renderMemoryGraphText(grafo([
      nodo('a', { projectKey: 'uno', projectDisplayName: 'uno' }),
      nodo('b', { projectKey: 'dos', projectDisplayName: 'dos' }),
    ], [{ from: 'a', to: 'b', kind: 'cross-topic', directed: false }]), { encabezado: '#auth' }, AHORA)
    expect(out).toContain('2 memorias')
    expect(out).toContain('2 proyectos')
  })

  // El circulo hueco es lo que hace que "reemplazada" se lea sin leyenda.
  it('una memoria reemplazada se dibuja distinto de una vigente', () => {
    const out = renderMemoryGraphText(grafo([
      nodo('viva', { title: 'la vigente' }),
      nodo('vieja', { title: 'la reemplazada', superseded: true }),
    ], [{ from: 'vieja', to: 'viva', kind: 'revision', directed: true }]), {}, AHORA)
    const lineaViva = out.split('\n').find((l) => l.includes('la vigente'))!
    const lineaVieja = out.split('\n').find((l) => l.includes('la reemplazada'))!
    expect(lineaViva).toContain('●')
    expect(lineaVieja).toContain('○')
  })

  // Lo mismo que en 3D: la que cruza repos es la unica con trazo doble, y es lo que un grafo
  // de varios proyectos tiene para decir.
  it('la arista que cruza repos usa un trazo distinto del resto', () => {
    const out = renderMemoryGraphText(grafo([
      nodo('a', { projectKey: 'uno', projectDisplayName: 'uno', title: 'auth aca' }),
      nodo('b', { projectKey: 'dos', projectDisplayName: 'dos', title: 'auth alla' }),
    ], [{ from: 'a', to: 'b', kind: 'cross-topic', directed: false }]), {}, AHORA)
    expect(out).toContain('═══')
    expect(out).toContain('mismo tema, OTRO repo')
  })

  it('las relaciones dentro del mismo repo NO usan el trazo doble', () => {
    const out = renderMemoryGraphText(grafo([
      nodo('a'), nodo('b'),
    ], [{ from: 'a', to: 'b', kind: 'topic', directed: false }]), {}, AHORA)
    expect(out).not.toContain('═══')
    expect(out).toContain('mismo tema')
  })

  // Una fila que envuelve rompe el arbol: el dibujo depende de que cada nodo ocupe una linea.
  it('ninguna linea pasa del ancho pedido, por largo que sea el titulo', () => {
    const largo = 'Un titulo larguisimo que de ninguna manera entra en una terminal angosta y que ademas sigue'
    const out = renderMemoryGraphText(grafo([
      nodo('a', { title: largo }),
      nodo('b', { title: largo }),
    ], [{ from: 'a', to: 'b', kind: 'topic', directed: false }]), { ancho: 72 }, AHORA)
    for (const l of out.split('\n')) expect(l.length).toBeLessThanOrEqual(72)
  })

  // Las sueltas son la mayoria en una cuenta real: darles un bloque cada una llenaria la
  // pantalla de nada.
  it('las memorias sin conexiones se cuentan al pie en vez de ocupar el dibujo', () => {
    const out = renderMemoryGraphText(grafo([
      nodo('a'), nodo('b'), nodo('sola1'), nodo('sola2'), nodo('sola3'),
    ], [{ from: 'a', to: 'b', kind: 'topic', directed: false }]), {}, AHORA)
    expect(out).toContain('3 sin conectar')
    expect(out).not.toContain('titulo de sola2')
  })

  it('avisa cuando la consulta dejo cosas afuera', () => {
    const g = grafo([nodo('a'), nodo('b')], [{ from: 'a', to: 'b', kind: 'topic', directed: false }])
    const out = renderMemoryGraphText({ ...g, truncated: 40 }, {}, AHORA)
    expect(out).toContain('40 beyond the query limit')
  })

  // Una leyenda que nombra trazos que no estan en pantalla enseña mal.
  it('la leyenda nombra solo las relaciones que de verdad aparecen', () => {
    const out = renderMemoryGraphText(grafo([
      nodo('a'), nodo('b'),
    ], [{ from: 'a', to: 'b', kind: 'branch', directed: false }]), {}, AHORA)
    expect(out).toContain('misma rama')
    expect(out).not.toContain('mismo documento')
    expect(out).not.toContain('parecidas')
  })

  it('respeta el limite de memorias dibujadas', () => {
    const nodos = Array.from({ length: 12 }, (_, i) => nodo(`n${i}`, { title: `memoria ${i}` }))
    const aristas = nodos.slice(1).map((n) => ({ from: 'n0', to: n.syncId, kind: 'topic' as const, directed: false }))
    const out = renderMemoryGraphText(grafo(nodos, aristas), { limite: 5 }, AHORA)
    const dibujadas = out.split('\n').filter((l) => /memoria \d/.test(l)).length
    expect(dibujadas).toBeLessThanOrEqual(5)
    expect(out).toContain('more not shown')
  })
})

// `revision` es la unica dirigida, y una etiqueta fija dice lo contrario de lo que pasa en
// la mitad de los casos: depende de desde que punta se la lea.
describe('la direccion de una revision', () => {
  const g = (raizEsLaNueva: boolean) => {
    const nueva = nodo('nueva', { title: 'la nueva', updatedAt: AHORA })
    const vieja = nodo('vieja', { title: 'la vieja', superseded: true, updatedAt: AHORA - 99 * 86400_000 })
    // En el grafo, `from` es la reemplazada y `to` la que la reemplazo.
    const edges = [{ from: 'vieja', to: 'nueva', kind: 'revision' as const, directed: true }]
    // Un vecino de mas del lado que queremos como raiz, para que sea la mas conectada.
    const extra = nodo('extra', { title: 'otra cosa' })
    const edgesExtra = raizEsLaNueva
      ? [...edges, { from: 'nueva', to: 'extra', kind: 'topic' as const, directed: false }]
      : [...edges, { from: 'vieja', to: 'extra', kind: 'topic' as const, directed: false }]
    return grafo([nueva, vieja, extra], edgesExtra)
  }

  it('leida desde la nueva, dice que la de arriba reemplazo a la de abajo', () => {
    const out = renderMemoryGraphText(g(true), {}, AHORA)
    const i = out.split('\n').findIndex((l) => l.includes('la vieja'))
    expect(out.split('\n')[i + 1]).toContain('replaced by the one above')
  })

  it('leida desde la vieja, dice lo contrario', () => {
    const out = renderMemoryGraphText(g(false), {}, AHORA)
    const i = out.split('\n').findIndex((l) => l.includes('la nueva'))
    expect(out.split('\n')[i + 1]).toContain('replaces the one above')
  })
})
