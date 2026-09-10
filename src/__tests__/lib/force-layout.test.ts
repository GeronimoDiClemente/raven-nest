import { describe, it, expect } from 'vitest'
import { stepForceLayout, energiaTotal, type ForceNode, type ForceEdge } from '../../lib/force-layout'

const nodos = (n: number): ForceNode[] =>
  Array.from({ length: n }, (_, i) => ({ id: `n${i}`, x: Math.cos(i) * 50, y: Math.sin(i) * 50, vx: 0, vy: 0 }))

const dist = (a: ForceNode, b: ForceNode) => Math.hypot(a.x - b.x, a.y - b.y)

describe('force-layout — Hooke + Coulomb, como Obsidian', () => {
  it('dos nodos sin arista se repelen', () => {
    const ns: ForceNode[] = [
      { id: 'a', x: -10, y: 0, vx: 0, vy: 0 },
      { id: 'b', x: 10, y: 0, vx: 0, vy: 0 },
    ]
    const antes = dist(ns[0], ns[1])
    for (let i = 0; i < 30; i++) stepForceLayout(ns, [])
    expect(dist(ns[0], ns[1])).toBeGreaterThan(antes)
  })

  it('dos nodos unidos por una arista se acercan al largo de reposo', () => {
    const ns: ForceNode[] = [
      { id: 'a', x: -300, y: 0, vx: 0, vy: 0 },
      { id: 'b', x: 300, y: 0, vx: 0, vy: 0 },
    ]
    const es: ForceEdge[] = [{ from: 'a', to: 'b' }]
    for (let i = 0; i < 400; i++) stepForceLayout(ns, es, { largo: 80 })
    expect(dist(ns[0], ns[1])).toBeLessThan(160)
  })

  // La propiedad que hace que el grafo "se acomode" en vez de vibrar para siempre.
  it('el sistema converge: la energía baja y se queda quieta', () => {
    const ns = nodos(12)
    const es: ForceEdge[] = [{ from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n0', to: 'n3' }]
    for (let i = 0; i < 50; i++) stepForceLayout(ns, es)
    const media = energiaTotal(ns)
    for (let i = 0; i < 600; i++) stepForceLayout(ns, es)
    const final = energiaTotal(ns)
    expect(final).toBeLessThan(media)
    expect(final).toBeLessThan(0.5)
  })

  it('lo denso queda más junto que lo aislado', () => {
    // El comportamiento visible de Obsidian: los clusters se agrupan al centro
    // y lo que no tiene aristas deriva al borde.
    const ns = nodos(6)
    const es: ForceEdge[] = [
      { from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n2', to: 'n0' },
    ]
    for (let i = 0; i < 800; i++) stepForceLayout(ns, es)
    const centro = (ids: string[]) => {
      const p = ns.filter((n) => ids.includes(n.id))
      return { x: p.reduce((s, n) => s + n.x, 0) / p.length, y: p.reduce((s, n) => s + n.y, 0) / p.length }
    }
    const c = centro(['n0', 'n1', 'n2'])
    const radio = (ids: string[]) =>
      Math.max(...ns.filter((n) => ids.includes(n.id)).map((n) => Math.hypot(n.x - c.x, n.y - c.y)))
    expect(radio(['n0', 'n1', 'n2'])).toBeLessThan(radio(['n3', 'n4', 'n5']))
  })

  it('nunca produce NaN, ni con dos nodos exactamente encima', () => {
    // Sin la distancia mínima, la repulsión divide por cero y todo el grafo
    // se vuelve NaN — y un SVG con NaN no dibuja nada, en silencio.
    const ns: ForceNode[] = [
      { id: 'a', x: 0, y: 0, vx: 0, vy: 0 },
      { id: 'b', x: 0, y: 0, vx: 0, vy: 0 },
    ]
    for (let i = 0; i < 20; i++) stepForceLayout(ns, [])
    for (const n of ns) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
  })
})
