import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Capture the data callback that hub-activity registers via subscribeToPtyData,
// so tests can push synthetic PTY chunks at it.
const h = vi.hoisted(() => ({ dataCb: null as null | ((paneId: string, data: string) => void) }))
vi.mock('../../pty-events', () => ({
  subscribeToPtyData: (cb: (paneId: string, data: string) => void) => {
    h.dataCb = cb
    return () => { h.dataCb = null }
  },
  onStopListening: () => {},
}))

import { useHubActivity, resetHubActivity } from '../../hub-activity'

describe('useHubActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetHubActivity()
    h.dataCb = null
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks a pane active when it emits visible output', () => {
    const { result } = renderHook(() => useHubActivity())
    act(() => { h.dataCb!('pane-1', 'building...\n') })
    expect(result.current.has('pane-1')).toBe(true)
  })

  it('ignores chunks with no visible output (cursor/escape repaints)', () => {
    const { result } = renderHook(() => useHubActivity())
    act(() => { h.dataCb!('pane-1', '\x1b[2K\x1b[1G') })
    expect(result.current.has('pane-1')).toBe(false)
  })

  it('keeps a pane active on spinner output but clears after the quiet window', () => {
    const { result } = renderHook(() => useHubActivity())
    act(() => { h.dataCb!('pane-1', '\x1b[2K⠋ Thinking') })
    expect(result.current.has('pane-1')).toBe(true)
    act(() => { vi.advanceTimersByTime(4000) })
    expect(result.current.has('pane-1')).toBe(false)
  })

  it('resetHubActivity clears active panes', () => {
    const { result } = renderHook(() => useHubActivity())
    act(() => { h.dataCb!('pane-1', 'output') })
    expect(result.current.has('pane-1')).toBe(true)
    act(() => { resetHubActivity() })
    expect(result.current.has('pane-1')).toBe(false)
  })
})
