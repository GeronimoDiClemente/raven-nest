import { describe, it, expect } from 'vitest'
import { buildThreadGraph, GRAPH_NODE_CAP } from '../../lib/team-thread-graph'
import type { TeamThreadBranch } from '../../types'

const AHORA = Date.UTC(2026, 8, 8, 12, 0)

function branch(over: Partial<TeamThreadBranch> = {}): TeamThreadBranch {
  return { slug: 'main', branch: 'main', estado: 'activa', ultimoAutor: 'Gero', ultimaEntrada: AHORA, entradas: 1, ...over }
}

describe('buildThreadGraph', () => {
  it('el indice va al centro y las ramas alrededor', () => {
    const g = buildThreadGraph({ branches: [branch({ slug: 'a' }), branch({ slug: 'b' })], focus: null, ahora: AHORA, global: true })

    const centro = g.nodes.find((n) => n.id === '_index')!
    expect(centro.x).toBe(0)
    expect(centro.y).toBe(0)
    expect(g.nodes.filter((n) => n.id !== '_index')).toHaveLength(2)
    expect(g.edges).toEqual(expect.arrayContaining([{ from: '_index', to: 'a' }, { from: '_index', to: 'b' }]))
  })

  it('el layout es DETERMINISTICO: mismas entradas, mismas coordenadas', () => {
    const input = { branches: [branch({ slug: 'a' }), branch({ slug: 'b' }), branch({ slug: 'c' })], focus: null, ahora: AHORA, global: true }
    expect(buildThreadGraph(input).nodes.map((n) => [n.id, n.x, n.y]))
      .toEqual(buildThreadGraph(input).nodes.map((n) => [n.id, n.x, n.y]))
  })

  it('clasifica la frescura por antiguedad de la ultima entrada', () => {
    const g = buildThreadGraph({
      branches: [
        branch({ slug: 'hoy', ultimaEntrada: AHORA - 3 * 3600_000 }),
        branch({ slug: 'semana', ultimaEntrada: AHORA - 3 * 86400_000 }),
        branch({ slug: 'mes', ultimaEntrada: AHORA - 20 * 86400_000 }),
        branch({ slug: 'viejo', ultimaEntrada: AHORA - 90 * 86400_000 }),
      ],
      focus: null, ahora: AHORA, global: true,
    })

    const f = (id: string): string => g.nodes.find((n) => n.id === id)!.frescura
    expect(f('hoy')).toBe('hoy')
    expect(f('semana')).toBe('semana')
    expect(f('mes')).toBe('mes')
    expect(f('viejo')).toBe('viejo')
  })

  it('el modo local muestra solo el foco y sus vecinos', () => {
    const g = buildThreadGraph({
      branches: [branch({ slug: 'a' }), branch({ slug: 'b' }), branch({ slug: 'c' })],
      focus: 'a', ahora: AHORA, global: false,
    })

    expect(g.nodes.map((n) => n.id).sort()).toEqual(['_index', 'a'])
    expect(g.nodes.find((n) => n.id === 'a')!.foco).toBe(true)
  })

  it('arriba del techo recorta por recencia y lo informa', () => {
    const branches = Array.from({ length: GRAPH_NODE_CAP + 40 }, (_, i) =>
      branch({ slug: `r${i}`, ultimaEntrada: i }))
    const g = buildThreadGraph({ branches, focus: null, ahora: AHORA, global: true })

    expect(g.nodes.length).toBe(GRAPH_NODE_CAP + 1) // +1 por el indice
    expect(g.recortados).toBe(40)
    expect(g.nodes.some((n) => n.id === `r${GRAPH_NODE_CAP + 39}`)).toBe(true) // el mas reciente sobrevive
  })
})

// Minor de Task 9 promovido a pre-merge por la review final: `id` es el slug y el
// componente resuelve las aristas por id. El camino de escritura ya desempata la colision
// de slugs; el de lectura no tenia guarda.
describe('dedupe por slug', () => {
  it('dos ramas que slugean igual producen UN solo nodo, y sobrevive la mas reciente', () => {
    const graph = buildThreadGraph({
      branches: [
        { slug: 'feat-x', branch: 'feat/x', estado: 'activa', ultimoAutor: 'Gero', ultimaEntrada: 1000, entradas: 1 },
        { slug: 'feat-x', branch: 'feat_x', estado: 'cerrada', ultimoAutor: 'Bauti', ultimaEntrada: 5000, entradas: 3 },
      ],
      focus: null,
      ahora: 5000,
      global: true,
    })

    const ramas = graph.nodes.filter((n) => n.id !== '_index')
    expect(ramas).toHaveLength(1)
    expect(ramas[0].label).toBe('feat_x')
    expect(graph.edges).toHaveLength(1)
  })
})
