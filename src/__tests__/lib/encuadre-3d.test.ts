import { describe, it, expect } from 'vitest'
import { cajaSinExtremos, fuerzaHaciaElCentro } from '../../lib/encuadre-3d'

const p = (x: number, y = 0, z = 0) => ({ x, y, z })

describe('cajaSinExtremos', () => {
  it('con pocos nodos no descarta ninguno: cada uno es una parte grande del grafo', () => {
    const caja = cajaSinExtremos([p(-10), p(0), p(50)])!
    expect(caja.x).toEqual({ min: -10, max: 50 })
  })

  it('un nodo suelto lejísimos no agranda la caja', () => {
    // 40 nodos apiñados entre 0 y 39, y uno perdido en 1000: es el caso de la captura,
    // donde los grupos sueltos alejaban la cámara y el grafo quedaba en un puñito.
    const puntos = [...Array.from({ length: 40 }, (_, i) => p(i)), p(1000)]
    const caja = cajaSinExtremos(puntos)!
    expect(caja.x.max).toBeLessThan(100)
    expect(caja.x.min).toBeGreaterThanOrEqual(0)
  })

  it('recorta cada eje por separado', () => {
    const puntos = [
      ...Array.from({ length: 40 }, (_, i) => p(i, i * 2, 0)),
      p(0, -5000, 0),
    ]
    const caja = cajaSinExtremos(puntos)!
    expect(caja.y.min).toBeGreaterThanOrEqual(0)
    expect(caja.x).toEqual({ min: expect.any(Number), max: expect.any(Number) })
    expect(caja.x.max - caja.x.min).toBeGreaterThan(30)
  })

  it('ignora los nodos que todavía no tienen posición', () => {
    const caja = cajaSinExtremos([p(1), { x: undefined, y: 3, z: 3 }, p(5)])!
    expect(caja.x).toEqual({ min: 1, max: 5 })
  })

  it('sin nodos con posición devuelve null', () => {
    expect(cajaSinExtremos([{}])).toBeNull()
  })
})

describe('fuerzaHaciaElCentro', () => {
  it('empuja la velocidad de cada nodo hacia el origen, proporcional a la distancia', () => {
    const lejos = { x: 100, y: -50, z: 0, vx: 0, vy: 0, vz: 0 }
    const cerca = { x: 10, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
    const f = fuerzaHaciaElCentro(0.1)
    f.initialize!([lejos, cerca])
    f(1)
    expect(lejos.vx).toBeCloseTo(-10)
    expect(lejos.vy).toBeCloseTo(5)
    expect(cerca.vx).toBeCloseTo(-1)
    expect(Math.abs(lejos.vx)).toBeGreaterThan(Math.abs(cerca.vx))
  })

  it('se apaga con la simulación: escala con alpha', () => {
    const n = { x: 100, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
    const f = fuerzaHaciaElCentro(0.1)
    f.initialize!([n])
    f(0)
    expect(n.vx).toBe(0)
  })

  it('no toca nodos fijados por un arrastre', () => {
    const fijo = { x: 100, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fx: 100 }
    const f = fuerzaHaciaElCentro(0.1)
    f.initialize!([fijo])
    f(1)
    expect(fijo.vx).toBe(0)
  })
})
