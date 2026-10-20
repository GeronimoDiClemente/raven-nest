import { describe, it, expect } from 'vitest'
import { vecinos, subgrafoLocal, opacidadDeNodo, esInferida } from '../../lib/memory-graph-2d'
import type { GraphData } from '../../lib/memory-graph-visuals'

const nodo = (id: string) => ({ id, label: id, color: '#fff', val: 1, degree: 1, superseded: false, type: 'decision', projectKey: 'p', projectLabel: 'p', tags: [], gitBranch: null, pending: false })
const data: GraphData = {
  nodes: ['a', 'b', 'c', 'd'].map(nodo),
  links: [{ source: 'a', target: 'b', kind: 'wikilink' }, { source: 'b', target: 'c', kind: 'similar' }, { source: 'c', target: 'd', kind: 'manual' }],
  orphansHidden: 0,
}

describe('memory-graph-2d', () => {
  it('vecinos en las dos direcciones', () => {
    expect([...vecinos(data.links, 'b')].sort()).toEqual(['a', 'c'])
  })
  it('subgrafo local a 1 y a 2 saltos', () => {
    expect(subgrafoLocal(data, 'a', 1).nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(subgrafoLocal(data, 'a', 2).nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
    expect(subgrafoLocal(data, 'a', 2).links).toHaveLength(2)
  })
  it('inferidas son las que no afirma nadie', () => {
    expect(esInferida('similar')).toBe(true)
    expect(esInferida('branch')).toBe(true)
    expect(esInferida('wikilink')).toBe(false)
    expect(esInferida('manual')).toBe(false)
    expect(esInferida('revision')).toBe(false)
  })
  it('hover atenua todo menos el nodo y sus vecinos; la busqueda atenua lo que no coincide', () => {
    const v = vecinos(data.links, 'b')
    expect(opacidadDeNodo('a', 'b', v, null)).toBe(1)
    expect(opacidadDeNodo('d', 'b', v, null)).toBeLessThan(0.3)
    expect(opacidadDeNodo('d', null, new Set(), new Set(['a']))).toBeLessThan(0.3)
    expect(opacidadDeNodo('a', null, new Set(), new Set(['a']))).toBe(1)
  })
})
