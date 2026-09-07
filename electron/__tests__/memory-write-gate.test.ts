// Adversarial review (alto, smoke/memory-bridge): memorySink.save() in main.ts had no
// protection against the window inside performUserSwap() where the old store is already
// closed but `memory` hasn't been reassigned to the post-swap one yet. SwapWriteGate is the
// fix — this file tests the class in isolation, same as memory-account-switch.ts's own
// tests do for its narrow orchestration logic, no `electron` import involved.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { SwapWriteGate } from '../memory-write-gate'

describe('SwapWriteGate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('offer() before any beginSwap() always proceeds immediately', () => {
    const gate = new SwapWriteGate<string>()
    expect(gate.offer('a')).toBe(true)
    expect(gate.offer('b')).toBe(true)
  })

  it('offer() during swapping defers the write and returns false', () => {
    const gate = new SwapWriteGate<string>()
    gate.beginSwap()
    expect(gate.offer('a')).toBe(false)
    expect(gate.offer('b')).toBe(false)
  })

  it('offer() resumes proceeding immediately once endSwap() has run', () => {
    const gate = new SwapWriteGate<string>()
    gate.beginSwap()
    gate.offer('a')
    gate.endSwap(() => {})
    expect(gate.offer('c')).toBe(true)
  })

  it('endSwap() flushes every deferred item, in order, exactly once each', () => {
    const gate = new SwapWriteGate<string>()
    gate.beginSwap()
    gate.offer('a')
    gate.offer('b')
    gate.offer('c')
    const flushed: string[] = []
    gate.endSwap((item) => flushed.push(item))
    expect(flushed).toEqual(['a', 'b', 'c'])
  })

  it('endSwap() with nothing deferred calls the callback zero times', () => {
    const gate = new SwapWriteGate<string>()
    gate.beginSwap()
    const flush = vi.fn()
    gate.endSwap(flush)
    expect(flush).not.toHaveBeenCalled()
  })

  it('maxPending: once full, drops the OLDEST deferred item to make room and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gate = new SwapWriteGate<number>(3)
    gate.beginSwap()
    expect(gate.offer(1)).toBe(false)
    expect(gate.offer(2)).toBe(false)
    expect(gate.offer(3)).toBe(false)
    // Queue is now full (3/3) — offering a 4th must drop the oldest (1), not reject the new one.
    expect(gate.offer(4)).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('pending queue full')

    const flushed: number[] = []
    gate.endSwap((item) => flushed.push(item))
    expect(flushed).toEqual([2, 3, 4])
  })

  it('a second beginSwap()/endSwap() cycle starts with an empty queue', () => {
    const gate = new SwapWriteGate<string>()
    gate.beginSwap()
    gate.offer('a')
    gate.endSwap(() => {})

    gate.beginSwap()
    const flushed: string[] = []
    gate.endSwap((item) => flushed.push(item))
    expect(flushed).toEqual([])
  })
})
