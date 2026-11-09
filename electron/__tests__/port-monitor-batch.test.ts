import { describe, it, expect } from 'vitest'
import { portsForPids } from '../port-monitor'

describe('portsForPids', () => {
  const listening = new Map<number, number[]>([
    [10, [3000]],
    [11, [5173, 3000]],
    [99, [8080]],
  ])

  it('unions the ports of every pid in the tree, sorted and de-duplicated', () => {
    expect(portsForPids(listening, [10, 11, 12])).toEqual([3000, 5173])
  })

  it('ignores ports of pids outside the tree', () => {
    expect(portsForPids(listening, new Set([12, 13]))).toEqual([])
  })

  it('returns nothing when the socket scan came back empty', () => {
    expect(portsForPids(new Map(), [10, 11])).toEqual([])
  })
})
