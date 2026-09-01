import { describe, it, expect } from 'vitest'
import { resolveTopicCollision } from '../src/lww'

const c = (syncId: string, updatedAt: number, lamport: number) => ({ syncId, updatedAt, lamport })

describe('resolveTopicCollision', () => {
  it('prefers the greater updatedAt', () => {
    expect(resolveTopicCollision(c('a', 1, 9), c('b', 2, 1)).winner.syncId).toBe('b')
  })

  it('breaks an updatedAt tie with the greater lamport', () => {
    expect(resolveTopicCollision(c('a', 5, 1), c('b', 5, 2)).winner.syncId).toBe('b')
  })

  it('breaks a full tie with the greater syncId, lexicographically', () => {
    expect(resolveTopicCollision(c('a', 5, 5), c('b', 5, 5)).winner.syncId).toBe('b')
    expect(resolveTopicCollision(c('z', 5, 5), c('b', 5, 5)).winner.syncId).toBe('z')
  })

  it('is symmetric — argument order never changes the winner', () => {
    const x = c('x', 7, 3)
    const y = c('y', 7, 4)
    expect(resolveTopicCollision(x, y).winner.syncId).toBe(resolveTopicCollision(y, x).winner.syncId)
  })

  it('always returns the other one as the loser', () => {
    const r = resolveTopicCollision(c('a', 1, 1), c('b', 2, 2))
    expect(r.loser.syncId).toBe('a')
  })
})
