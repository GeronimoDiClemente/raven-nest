// Spec 2b-2 §4.7: con más proyectos que el tope, cuáles siguen aceptando mutaciones. Puro.
import { describe, it, expect } from 'vitest'
import { proyectosPermitidos } from '../src/proyectos-permitidos'

const p = (projectKey: string, id: number) => ({ projectKey, id })
const PROPIOS = [p('c', 30), p('a', 10), p('b', 20)] // desordenados a propósito

describe('proyectosPermitidos', () => {
  it('sin pasarse del tope, todos', () => {
    expect([...proyectosPermitidos(PROPIOS, null, 3)].sort()).toEqual(['a', 'b', 'c'])
    expect([...proyectosPermitidos(PROPIOS, 'b', 100)].sort()).toEqual(['a', 'b', 'c'])
  })

  it('pasado y sin elección: los maxProjects más viejos por id', () => {
    expect([...proyectosPermitidos(PROPIOS, null, 1)]).toEqual(['a'])
    expect([...proyectosPermitidos(PROPIOS, null, 2)].sort()).toEqual(['a', 'b'])
  })

  it('pasado y con elección: el elegido más los maxProjects - 1 más viejos restantes', () => {
    expect([...proyectosPermitidos(PROPIOS, 'c', 1)]).toEqual(['c'])
    expect([...proyectosPermitidos(PROPIOS, 'c', 2)].sort()).toEqual(['a', 'c'])
  })

  it('un elegido que ya no es propio cae a los más viejos', () => {
    expect([...proyectosPermitidos(PROPIOS, 'borrado', 1)]).toEqual(['a'])
  })

  it('sin proyectos, ninguno', () => {
    expect(proyectosPermitidos([], 'a', 1).size).toBe(0)
  })
})
