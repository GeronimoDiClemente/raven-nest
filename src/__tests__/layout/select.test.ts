import { describe, it, expect } from 'vitest'
import { defaultLayoutFor, alternativesFor, mapLegacyToPreset } from '../../layout/select'

describe('defaultLayoutFor', () => {
  it.each([
    [0, '1'], [1, '1'], [2, '2V'], [3, '3C'], [4, '4Q'],
    [5, '5T'], [6, '6G'], [7, '9G'], [9, '9G'], [12, '9G'],
  ] as const)('n=%i → %s', (n, expected) => {
    expect(defaultLayoutFor(n)).toBe(expected)
  })
})

describe('alternativesFor', () => {
  it('returns multiple options for N=2/3/4', () => {
    expect(alternativesFor(2)).toEqual(['2V', '2H'])
    expect(alternativesFor(3)).toEqual(['3C', '3M', '3T'])
    expect(alternativesFor(4)).toEqual(['4Q', '4M', '4T'])
  })

  it('returns just the default for N=1 and N>=5', () => {
    expect(alternativesFor(1)).toEqual(['1'])
    expect(alternativesFor(5)).toEqual(['5T'])
    expect(alternativesFor(6)).toEqual(['6G'])
    expect(alternativesFor(9)).toEqual(['9G'])
  })
})

describe('mapLegacyToPreset', () => {
  it.each([
    [1, 1, 1, '1'],
    [1, 2, 2, '2V'],
    [2, 1, 2, '2H'],
    [1, 3, 3, '3C'],
    [2, 2, 4, '4Q'],
    [2, 2, 3, '4Q'],
    [2, 3, 6, '6G'],
    [3, 3, 9, '9G'],
  ])('rows=%i cols=%i n=%i → %s', (rows, cols, n, expected) => {
    expect(mapLegacyToPreset(rows, cols, n)).toBe(expected)
  })

  it('falls back to defaultLayoutFor when shape is non-standard', () => {
    expect(mapLegacyToPreset(5, 7, 5)).toBe('5T')
  })
})
