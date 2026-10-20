import { describe, it, expect, vi, afterEach } from 'vitest'
import { leer, escribir, almacenDePaneles } from '../../lib/almacen-seguro'

describe('almacen-seguro', () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })
  it('lee y escribe con un storage sano', () => {
    escribir('k', 'v')
    expect(leer('k')).toBe('v')
    expect(almacenDePaneles.getItem('k')).toBe('v')
  })
  it('con un localStorage que tira, leer da null y escribir no tira', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(leer('k')).toBeNull()
    expect(() => escribir('k', 'v')).not.toThrow()
  })
})
