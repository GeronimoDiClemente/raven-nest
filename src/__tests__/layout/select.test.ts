import { describe, it, expect } from 'vitest'
import { defaultLayoutFor, alternativesFor, mapLegacyToPreset } from '../../layout/select'

describe('defaultLayoutFor', () => {
  it.each([
    [0, '1'], [1, '1'], [2, '2V'], [3, '3C'], [4, '4Q'],
    [5, '5T'], [6, '6G'], [7, '7T'], [8, '8G'], [9, '9G'],
    [10, '10G'], [11, '11G'], [12, '12G'],
    // N > 12 still resolves to the largest preset — engine clamps adds at MAX_PANES.
    [13, '12G'], [25, '12G'],
  ] as const)('n=%i → %s', (n, expected) => {
    expect(defaultLayoutFor(n)).toBe(expected)
  })
})

describe('alternativesFor', () => {
  it('returns just the default for N=1', () => {
    expect(alternativesFor(1)).toEqual(['1'])
  })

  it('returns multiple options for N=2/3/4', () => {
    expect(alternativesFor(2)).toEqual(['2V', '2H'])
    expect(alternativesFor(3)).toEqual(['3C', '3M', '3T'])
    expect(alternativesFor(4)).toEqual(['4Q', '4M', '4T'])
  })

  it('returns three options for N=5..12 (grid + master + variant)', () => {
    expect(alternativesFor(5)).toEqual(['5T', '5M', '5B'])
    expect(alternativesFor(6)).toEqual(['6G', '6M', '6C'])
    expect(alternativesFor(7)).toEqual(['7T', '7M', '7B'])
    expect(alternativesFor(8)).toEqual(['8G', '8M', '8B'])
    expect(alternativesFor(9)).toEqual(['9G', '9M', '9T'])
    expect(alternativesFor(10)).toEqual(['10G', '10M', '10B'])
    expect(alternativesFor(11)).toEqual(['11G', '11M', '11B'])
    expect(alternativesFor(12)).toEqual(['12G', '12M', '12C'])
  })

  it('falls back to the default beyond MAX_PANES', () => {
    expect(alternativesFor(13)).toEqual(['12G'])
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
