import { describe, it, expect } from 'vitest'
import { truncateWithEllipsis } from '../../lib/truncate'

describe('truncateWithEllipsis', () => {
  it('trunca strings de más de 40 caracteres con ellipsis', () => {
    const longString = 'a'.repeat(100)
    const result = truncateWithEllipsis(longString)
    expect(result).toBe('a'.repeat(40) + '…')
    expect(result.length).toBe(41) // 40 chars + ellipsis
  })

  it('deja strings de exactamente 40 caracteres sin cambios', () => {
    const string40 = 'a'.repeat(40)
    expect(truncateWithEllipsis(string40)).toBe(string40)
  })

  it('deja strings cortos sin cambios', () => {
    const shortString = 'short'
    expect(truncateWithEllipsis(shortString)).toBe(shortString)
  })
})
