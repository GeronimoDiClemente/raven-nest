import { describe, it, expect } from 'vitest'
import { ActivityLog } from '../integrations/activity-log'
import type { DomainEvent } from '../integrations/bus-types'

function prOpened(branch: string): DomainEvent {
  return { type: 'pr.opened', branch, repoFullName: 'o/r' }
}

describe('ActivityLog', () => {
  it('list() is empty when nothing was recorded', () => {
    expect(new ActivityLog().list()).toEqual([])
  })

  it('record() then list() returns the entry with its ev/ts', () => {
    const log = new ActivityLog()
    log.record(prOpened('feat/x'), 1000)
    expect(log.list()).toEqual([{ ev: prOpened('feat/x'), ts: 1000 }])
  })

  it('list() is newest-first', () => {
    const log = new ActivityLog()
    log.record(prOpened('a'), 1)
    log.record(prOpened('b'), 2)
    log.record(prOpened('c'), 3)
    expect(log.list().map((e) => e.ts)).toEqual([3, 2, 1])
  })

  it('caps at the configured capacity, dropping the oldest', () => {
    const log = new ActivityLog(3)
    log.record(prOpened('a'), 1)
    log.record(prOpened('b'), 2)
    log.record(prOpened('c'), 3)
    log.record(prOpened('d'), 4)
    expect(log.list().map((e) => e.ts)).toEqual([4, 3, 2])
  })

  it('defaults to a capacity of 50', () => {
    const log = new ActivityLog()
    for (let i = 1; i <= 55; i++) log.record(prOpened(`b${i}`), i)
    const list = log.list()
    expect(list).toHaveLength(50)
    expect(list[0].ts).toBe(55)
    expect(list[49].ts).toBe(6)
  })

  it('list() returns a defensive copy (mutating the result does not affect the log)', () => {
    const log = new ActivityLog()
    log.record(prOpened('a'), 1)
    const snap = log.list()
    snap.pop()
    expect(log.list()).toHaveLength(1)
  })
})
