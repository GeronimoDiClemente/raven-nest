import { describe, it, expect } from 'vitest'
import { resolveLWW, resolveTopicCollision, resolveDeleteVsUpdate } from '../memory-merge'

describe('memory-merge — resolveLWW (§4.3 rule a)', () => {
  it('picks the row with the later updatedAt', () => {
    const a = { syncId: 'obs-a', updatedAt: 100, lamport: 1 }
    const b = { syncId: 'obs-b', updatedAt: 200, lamport: 1 }
    expect(resolveLWW(a, b)).toBe(b)
    expect(resolveLWW(b, a)).toBe(b)
  })

  it('breaks an updatedAt tie with the higher lamport', () => {
    const a = { syncId: 'obs-a', updatedAt: 100, lamport: 5 }
    const b = { syncId: 'obs-b', updatedAt: 100, lamport: 9 }
    expect(resolveLWW(a, b)).toBe(b)
  })

  it('breaks an updatedAt+lamport tie with the greater syncId lexicographically', () => {
    const a = { syncId: 'obs-aaaa', updatedAt: 100, lamport: 5 }
    const b = { syncId: 'obs-zzzz', updatedAt: 100, lamport: 5 }
    expect(resolveLWW(a, b)).toBe(b)
    expect(resolveLWW(b, a)).toBe(b)
  })

  it('is deterministic regardless of argument order (commutative in outcome)', () => {
    const a = { syncId: 'obs-a', updatedAt: 500, lamport: 3 }
    const b = { syncId: 'obs-b', updatedAt: 500, lamport: 3 }
    // updatedAt and lamport tie -> syncId decides, same winner either order
    expect(resolveLWW(a, b).syncId).toBe(resolveLWW(b, a).syncId)
  })
})

describe('memory-merge — resolveTopicCollision (§4.3 rule b, append-first)', () => {
  it('picks a winner but returns the loser too — nothing is discarded', () => {
    const a = { syncId: 'obs-aaa', updatedAt: 100, lamport: 1 }
    const b = { syncId: 'obs-bbb', updatedAt: 200, lamport: 1 }
    const { winner, loser } = resolveTopicCollision(a, b)
    expect(winner).toBe(b)
    expect(loser).toBe(a)
  })

  it('walkthrough from §4.6: later edit on device D beats earlier offline note on device N', () => {
    // AAA refined Mon 21:00 (lamport bumped), BBB created Mon 19:00 on N while offline.
    const aaa = { syncId: 'AAA', updatedAt: new Date('2026-01-05T21:00:00Z').getTime(), lamport: 2 }
    const bbb = { syncId: 'BBB', updatedAt: new Date('2026-01-05T19:00:00Z').getTime(), lamport: 1 }
    const { winner, loser } = resolveTopicCollision(bbb, aaa)
    expect(winner.syncId).toBe('AAA')
    expect(loser.syncId).toBe('BBB')
  })
})

describe('memory-merge — resolveDeleteVsUpdate (§4.3 rule c)', () => {
  it('a later update resurrects over an earlier delete', () => {
    const deleted = { syncId: 'obs-a', updatedAt: 100, lamport: 1, deleted: true }
    const updated = { syncId: 'obs-a', updatedAt: 200, lamport: 1, deleted: false }
    expect(resolveDeleteVsUpdate(deleted, updated)).toBe(updated)
  })

  it('a later delete beats an earlier update', () => {
    const updated = { syncId: 'obs-a', updatedAt: 100, lamport: 1, deleted: false }
    const deleted = { syncId: 'obs-a', updatedAt: 200, lamport: 1, deleted: true }
    expect(resolveDeleteVsUpdate(updated, deleted)).toBe(deleted)
  })
})

describe('memory-merge — convergence property', () => {
  it('every ordering of a random set of writes converges on the same winner', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      syncId: `obs-${Math.random().toString(36).slice(2)}`,
      updatedAt: Math.floor(Math.random() * 10) * 100, // deliberately collide often
      lamport: Math.floor(Math.random() * 3),
    }))

    const reduceInOrder = (list: typeof rows) => list.reduce((acc, cur) => resolveLWW(acc, cur))
    const forward = reduceInOrder(rows)
    const shuffled = [...rows].sort(() => Math.random() - 0.5)
    const anyOrder = reduceInOrder(shuffled)
    const reversed = reduceInOrder([...rows].reverse())

    expect(anyOrder.syncId).toBe(forward.syncId)
    expect(reversed.syncId).toBe(forward.syncId)
  })
})
