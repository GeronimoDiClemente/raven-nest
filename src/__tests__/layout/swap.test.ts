import { describe, it, expect } from 'vitest'
import { swap } from '../../layout/swap'

describe('swap', () => {
  it('swaps two elements by index', () => {
    expect(swap([1, 2, 3], 0, 2)).toEqual([3, 2, 1])
  })

  it('returns a new array (does not mutate)', () => {
    const original = [1, 2, 3]
    const result = swap(original, 0, 1)
    expect(result).not.toBe(original)
    expect(original).toEqual([1, 2, 3])
  })

  it('is a no-op when i === j', () => {
    expect(swap([1, 2, 3], 1, 1)).toEqual([1, 2, 3])
  })

  it('returns the original array when an index is out of bounds', () => {
    expect(swap([1, 2, 3], 0, 5)).toEqual([1, 2, 3])
    expect(swap([1, 2, 3], -1, 1)).toEqual([1, 2, 3])
  })
})
