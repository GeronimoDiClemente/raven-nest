import { describe, it, expect } from 'vitest'
import { swap } from '../../layout/swap'

// swap INTERCAMBIA dos posiciones (deja el resto quieto). Es lo que se espera
// en un layout 2D de slots fijos: soltar A sobre B los intercambia. arrayMove
// en cambio DESPLAZA y cascadea a las del medio (el bug que reportó Gero).
describe('swap — intercambia dos posiciones, no desplaza', () => {
  it('intercambia i y j dejando el resto quieto', () => {
    expect(swap(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'c', 'b'])
  })

  it('es simétrico', () => {
    expect(swap(['a', 'b', 'c'], 0, 2)).toEqual(['c', 'b', 'a'])
  })

  it('i === j → devuelve el MISMO array (sin recrear)', () => {
    const arr = ['a', 'b']
    expect(swap(arr, 1, 1)).toBe(arr)
  })

  it('índices fuera de rango → sin cambios (mismo array)', () => {
    const arr = ['a', 'b']
    expect(swap(arr, 0, 5)).toBe(arr)
    expect(swap(arr, -1, 1)).toBe(arr)
  })
})
