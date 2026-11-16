import { describe, it, expect, vi } from 'vitest'
import { typeThenSubmit } from '../orchestration/submit'

describe('typeThenSubmit', () => {
  it('escribe el texto ya y el Enter a los 500 ms', () => {
    vi.useFakeTimers()
    const write = vi.fn()
    typeThenSubmit(write, (fn, ms) => setTimeout(fn, ms), 'p1', 'hola')
    expect(write.mock.calls).toEqual([['p1', 'hola']])
    vi.advanceTimersByTime(499)
    expect(write).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(write.mock.calls[1]).toEqual(['p1', '\r'])
    vi.useRealTimers()
  })
})
