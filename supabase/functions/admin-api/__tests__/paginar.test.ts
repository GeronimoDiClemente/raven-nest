import { describe, it, expect, vi } from 'vitest'
import { paginarTodo } from '../paginar.ts'

describe('paginarTodo', () => {
  it('una sola pagina incompleta: alcanza con una llamada', async () => {
    const fetchPagina = vi.fn(async (page: number) => (page === 1 ? ['a', 'b', 'c'] : []))
    const r = await paginarTodo(fetchPagina, 10)
    expect(r).toEqual({ items: ['a', 'b', 'c'], truncado: false })
    expect(fetchPagina).toHaveBeenCalledTimes(1)
  })

  it('varias paginas exactas hasta una mas corta: acumula todo', async () => {
    const paginas: Record<number, string[]> = {
      1: ['a', 'b'],
      2: ['c', 'd'],
      3: ['e'],
    }
    const fetchPagina = vi.fn(async (page: number) => paginas[page] ?? [])
    const r = await paginarTodo(fetchPagina, 2)
    expect(r).toEqual({ items: ['a', 'b', 'c', 'd', 'e'], truncado: false })
    expect(fetchPagina).toHaveBeenCalledTimes(3)
  })

  // Distinto del caso anterior: la última página viene vacía, no más corta.
  // Las dos formas de "se acabó" tienen que cortar igual, sin depender de
  // ningún header ni de un total.
  it('pagina vacia al final: tambien corta y no cuenta como truncado', async () => {
    const paginas: Record<number, string[]> = {
      1: ['a', 'b'],
      2: ['c', 'd'],
      3: [],
    }
    const fetchPagina = vi.fn(async (page: number) => paginas[page] ?? [])
    const r = await paginarTodo(fetchPagina, 2)
    expect(r).toEqual({ items: ['a', 'b', 'c', 'd'], truncado: false })
    expect(fetchPagina).toHaveBeenCalledTimes(3)
  })

  it('primera pagina vacia: cero items, no truncado', async () => {
    const fetchPagina = vi.fn(async () => [])
    const r = await paginarTodo(fetchPagina, 50)
    expect(r).toEqual({ items: [], truncado: false })
    expect(fetchPagina).toHaveBeenCalledTimes(1)
  })

  // El caso del bug real: una fuente que nunca devuelve una página corta se
  // frena en el tope de seguridad en vez de colgarse en un loop infinito, y
  // ahí sí se reporta truncado — es la única señal de truncamiento que este
  // módulo conoce de verdad, sin depender de `total` ni del header `link`.
  it('tope de seguridad alcanzado: corta y marca truncado', async () => {
    const fetchPagina = vi.fn(async () => ['x', 'y'])
    const r = await paginarTodo(fetchPagina, 2, 3)
    expect(r.items).toEqual(['x', 'y', 'x', 'y', 'x', 'y'])
    expect(r.truncado).toBe(true)
    expect(fetchPagina).toHaveBeenCalledTimes(3)
  })

  it('pide las paginas en orden ascendente empezando en 1', async () => {
    const vistas: number[] = []
    const fetchPagina = vi.fn(async (page: number) => {
      vistas.push(page)
      return page < 3 ? ['x', 'y'] : ['z']
    })
    await paginarTodo(fetchPagina, 2)
    expect(vistas).toEqual([1, 2, 3])
  })
})
