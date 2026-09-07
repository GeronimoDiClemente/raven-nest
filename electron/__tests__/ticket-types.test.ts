import { describe, it, expect } from 'vitest'
import { isTicket } from '../integrations/ticket-types'

const valid = {
  key: 'PROJ-1', providerId: 'p1', title: 'Fix', url: 'u', state: 'todo', context: 'ctx',
}

describe('isTicket', () => {
  it('acepta un ticket bien formado', () => {
    expect(isTicket(valid)).toBe(true)
  })

  it('rechaza null/undefined/primitivos', () => {
    expect(isTicket(null)).toBe(false)
    expect(isTicket(undefined)).toBe(false)
    expect(isTicket('ticket')).toBe(false)
    expect(isTicket(42)).toBe(false)
  })

  it('rechaza campos faltantes o no-string (irían interpolados a TASK.md)', () => {
    expect(isTicket({ ...valid, key: undefined })).toBe(false)
    expect(isTicket({ ...valid, title: 7 })).toBe(false)
    expect(isTicket({ ...valid, url: null })).toBe(false)
    expect(isTicket({ ...valid, context: {} })).toBe(false)
    expect(isTicket({ ...valid, providerId: ['p1'] })).toBe(false)
  })

  it('rechaza un state fuera del enum', () => {
    expect(isTicket({ ...valid, state: 'blocked' })).toBe(false)
    expect(isTicket({ ...valid, state: undefined })).toBe(false)
  })
})
