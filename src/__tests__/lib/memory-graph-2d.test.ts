import { describe, it, expect } from 'vitest'
import { vecinos, subgrafoLocal, opacidadDeNodo, esInferida, conPosicionesDe, claveDeDibujo, encuadreLocal } from '../../lib/memory-graph-2d'
import type { GraphData } from '../../lib/memory-graph-visuals'
import { muestraEtiqueta, ticksDelMotor, ZOOM_RELATIVO_DE_ETIQUETAS } from '../../lib/memory-graph-2d'

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
  it('el subgrafo local trae COPIAS: fijar un nodo ahi no lo fija en el global (F6)', () => {
    const local = subgrafoLocal(data, 'a', 1)
    const a = local.nodes.find((n) => n.id === 'a') as { fx?: number }
    a.fx = 10
    expect((data.nodes[0] as { fx?: number }).fx).toBeUndefined()
    expect(local.nodes[0]).not.toBe(data.nodes[0])
    expect(local.links[0]).not.toBe(data.links[0])
    // Aunque la libreria ya haya cambiado source/target por objetos, la copia lleva ids.
    const mutado: GraphData = { ...data, links: [{ source: data.nodes[0] as never, target: data.nodes[1] as never, kind: 'wikilink' }] }
    expect(subgrafoLocal(mutado, 'a', 1).links[0]).toMatchObject({ source: 'a', target: 'b' })
  })
  it('datos nuevos conservan las posiciones de los anteriores por id, en copias (F6)', () => {
    const viejo: GraphData = { ...data, nodes: data.nodes.map((n, i) => ({ ...n, x: i, y: i * 2, vx: 0, vy: 0, ...(n.id === 'b' ? { fx: 5, fy: 6 } : {}) })) }
    const nuevo: GraphData = { ...data, nodes: ['a', 'b', 'c', 'd', 'e'].map(nodo) }
    const r = conPosicionesDe(viejo, nuevo)
    expect(r.nodes.find((n) => n.id === 'c')).toMatchObject({ x: 2, y: 4 })
    expect(r.nodes.find((n) => n.id === 'b')).toMatchObject({ fx: 5, fy: 6 })
    expect((r.nodes.find((n) => n.id === 'e') as { x?: number }).x).toBeUndefined()
    expect(r.nodes[0]).not.toBe(nuevo.nodes[0])
    expect((nuevo.nodes[0] as { x?: number }).x).toBeUndefined()
  })
  it('la clave de dibujo cambia con lo que se ve, no con las posiciones', () => {
    const conPos: GraphData = { ...data, nodes: data.nodes.map((n) => ({ ...n, x: 99 })) }
    expect(claveDeDibujo(conPos)).toBe(claveDeDibujo(data))
    expect(claveDeDibujo({ ...data, nodes: data.nodes.map((n) => (n.id === 'a' ? { ...n, label: 'otro' } : n)) })).not.toBe(claveDeDibujo(data))
  })
})

describe('encuadreLocal (V3)', () => {
  const margen = { x: 60, arriba: 10, abajo: 30 }
  it('deja margen para las etiquetas: los puntos caen dentro del area util', () => {
    const nodos = [{ x: -100, y: -50 }, { x: 100, y: 50 }, { x: 0, y: 0 }]
    const e = encuadreLocal(nodos, 280, 180, margen, 3)!
    const pantalla = (n: { x: number; y: number }) => ({ x: (n.x - e.x) * e.k + 140, y: (n.y - e.y) * e.k + 90 })
    for (const n of nodos) {
      const p = pantalla(n)
      expect(p.x).toBeGreaterThanOrEqual(60 - 1e-9)
      expect(p.x).toBeLessThanOrEqual(220 + 1e-9)
      expect(p.y).toBeGreaterThanOrEqual(10 - 1e-9)
      expect(p.y).toBeLessThanOrEqual(150 + 1e-9)
    }
    expect(e.k).toBeCloseTo(0.8)
  })
  it('un solo nodo no queda gigante: zoom con tope', () => {
    expect(encuadreLocal([{ x: 5, y: 5 }], 280, 180, margen, 3)!.k).toBe(3)
  })
  it('sin posiciones todavia: null', () => {
    expect(encuadreLocal([{}], 280, 180, margen, 3)).toBeNull()
  })
})

describe('muestraEtiqueta', () => {
  const base = { modo: 'global' as const, etiquetas: 'zoom' as const, escala: 1, zoomDeEncuadre: 1, destacado: false }
  it('When zoomed in: aparece pasando el umbral relativo al encuadre', () => {
    expect(muestraEtiqueta(base)).toBe(false)
    expect(muestraEtiqueta({ ...base, escala: ZOOM_RELATIVO_DE_ETIQUETAS })).toBe(true)
    expect(muestraEtiqueta({ ...base, zoomDeEncuadre: null, escala: 10 })).toBe(false)
  })
  it('Always siempre; On hover sólo el destacado', () => {
    expect(muestraEtiqueta({ ...base, etiquetas: 'always' })).toBe(true)
    expect(muestraEtiqueta({ ...base, etiquetas: 'hover', escala: 10 })).toBe(false)
    expect(muestraEtiqueta({ ...base, etiquetas: 'hover', destacado: true })).toBe(true)
  })
  it('el local siempre tiene etiquetas (D13)', () => {
    expect(muestraEtiqueta({ ...base, modo: 'local', etiquetas: 'hover' })).toBe(true)
  })
})

describe('ticksDelMotor', () => {
  it('animado: los ticks de siempre', () => {
    expect(ticksDelMotor({ modo: 'global', sinAcomodo: true, animar: true })).toEqual({ warmupTicks: 80, cooldownTicks: 150 })
    expect(ticksDelMotor({ modo: 'global', sinAcomodo: false, animar: true })).toEqual({ warmupTicks: 0, cooldownTicks: 150 })
    expect(ticksDelMotor({ modo: 'local', sinAcomodo: true, animar: false })).toEqual({ warmupTicks: 40, cooldownTicks: 60 })
  })
  it('sin animación el global se acomoda sin dibujar y aparece quieto', () => {
    expect(ticksDelMotor({ modo: 'global', sinAcomodo: true, animar: false })).toEqual({ warmupTicks: 300, cooldownTicks: 0 })
    expect(ticksDelMotor({ modo: 'global', sinAcomodo: false, animar: false })).toEqual({ warmupTicks: 120, cooldownTicks: 0 })
  })
})
