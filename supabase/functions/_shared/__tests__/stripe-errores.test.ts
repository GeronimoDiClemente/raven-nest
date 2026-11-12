import { describe, it, expect } from 'vitest'
import { esClienteInexistente } from '../stripe-errores.ts'

describe('esClienteInexistente', () => {
  it('sólo el resource_missing sobre el parámetro customer', () => {
    expect(esClienteInexistente({ code: 'resource_missing', param: 'customer' })).toBe(true)
    expect(esClienteInexistente({ code: 'resource_missing', param: 'price' })).toBe(false)
    expect(esClienteInexistente({ code: 'card_declined', param: 'customer' })).toBe(false)
    expect(esClienteInexistente(null)).toBe(false)
    expect(esClienteInexistente(undefined)).toBe(false)
    expect(esClienteInexistente('resource_missing')).toBe(false)
    expect(esClienteInexistente(new Error('boom'))).toBe(false)
  })
})
