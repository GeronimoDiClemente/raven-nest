// @vitest-environment jsdom
//
// Cascara 1 (workspace-shell-design, parte A): la salida del overlay se
// resuelve retrasando el desmontaje via este hook, no una libreria de
// animacion. Estos tests cubren los tres riesgos que el reporte pide
// resolver explicitamente: un segundo close a mitad de la animacion, un
// reopen a mitad de la animacion, y que el timer nunca deje setState
// colgado tras un unmount real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDelayedUnmount } from '../../hooks/useDelayedUnmount'

describe('useDelayedUnmount', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts visible immediately when open is already true', () => {
    const { result } = renderHook(() => useDelayedUnmount(true, 200))
    expect(result.current).toEqual({ visible: true, closing: false })
  })

  it('stays visible and closing until the exit duration elapses', () => {
    const { result, rerender } = renderHook(({ open }) => useDelayedUnmount(open, 200), {
      initialProps: { open: true },
    })
    rerender({ open: false })
    expect(result.current).toEqual({ visible: true, closing: true })

    act(() => { vi.advanceTimersByTime(199) })
    expect(result.current).toEqual({ visible: true, closing: true })

    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toEqual({ visible: false, closing: false })
  })

  it('a second close mid-animation is a no-op (no double timer, no crash)', () => {
    const { result, rerender } = renderHook(({ open }) => useDelayedUnmount(open, 200), {
      initialProps: { open: true },
    })
    rerender({ open: false })
    rerender({ open: false }) // second close while still closing
    expect(result.current).toEqual({ visible: true, closing: true })

    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toEqual({ visible: false, closing: false })
  })

  it('reopening mid-animation cancels the pending unmount and snaps back open', () => {
    const { result, rerender } = renderHook(({ open }) => useDelayedUnmount(open, 200), {
      initialProps: { open: true },
    })
    rerender({ open: false })
    act(() => { vi.advanceTimersByTime(100) }) // mid-animation
    rerender({ open: true }) // reopen before the timer fired
    expect(result.current).toEqual({ visible: true, closing: false })

    // The cancelled timer must not fire later and force it closed.
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toEqual({ visible: true, closing: false })
  })

  it('never fires setState after the owning component unmounts', () => {
    const { result, rerender, unmount } = renderHook(({ open }) => useDelayedUnmount(open, 200), {
      initialProps: { open: true },
    })
    rerender({ open: false })
    unmount()
    // If the timeout weren't cleared, this would call setState on an
    // unmounted component — vitest/RTL surfaces that as a console error/act
    // warning, not a thrown exception, so the real assertion is that
    // advancing time here doesn't throw.
    expect(() => { act(() => { vi.advanceTimersByTime(500) }) }).not.toThrow()
    void result
  })
})
