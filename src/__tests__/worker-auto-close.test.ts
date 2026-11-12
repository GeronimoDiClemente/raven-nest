// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useWorkerAutoClose,
  formatAutoCloseCountdown,
  autoCloseDurationMs,
  WORKER_AUTO_CLOSE_MS,
} from '../orchestration/worker-auto-close'
import type { OrchestrationWorkerStatus } from '../types'

interface P { status: OrchestrationWorkerStatus; keepOpen: boolean; busy: boolean }

const montar = (inicial: P, onDue = vi.fn()) => {
  const r = renderHook((p: P) => useWorkerAutoClose({ ...p, durationMs: WORKER_AUTO_CLOSE_MS, onDue }), {
    initialProps: inicial,
  })
  return { ...r, onDue }
}
const avanzar = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

describe('cierre automático del pane de un worker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    delete (window as { orchestration?: unknown }).orchestration
  })

  it('banner cierra a los 120 s', () => {
    const { result, onDue } = montar({ status: 'done', keepOpen: false, busy: false })
    expect(result.current.phase).toBe('counting')
    expect(formatAutoCloseCountdown(result.current.remainingMs)).toBe('2:00')
    avanzar(119_000)
    expect(onDue).not.toHaveBeenCalled()
    expect(formatAutoCloseCountdown(result.current.remainingMs)).toBe('0:01')
    avanzar(1_000)
    expect(onDue).toHaveBeenCalledTimes(1)
    avanzar(10_000)
    expect(onDue).toHaveBeenCalledTimes(1)
  })

  it('Keep open cancela el cierre', () => {
    const { result, rerender, onDue } = montar({ status: 'done', keepOpen: false, busy: false })
    avanzar(60_000)
    rerender({ status: 'done', keepOpen: true, busy: false })
    expect(result.current.phase).toBe('kept')
    avanzar(300_000)
    expect(onDue).not.toHaveBeenCalled()
  })

  it('output nuevo suspende la cuenta', () => {
    const { result, rerender, onDue } = montar({ status: 'done', keepOpen: false, busy: false })
    avanzar(100_000)
    rerender({ status: 'done', keepOpen: false, busy: true })
    expect(result.current.phase).toBe('paused')
    avanzar(100_000)
    expect(onDue).not.toHaveBeenCalled()
    // Cuando el agente vuelve a quedar quieto la cuenta arranca de nuevo, entera (como Orca).
    rerender({ status: 'done', keepOpen: false, busy: false })
    expect(formatAutoCloseCountdown(result.current.remainingMs)).toBe('2:00')
    avanzar(119_000)
    expect(onDue).not.toHaveBeenCalled()
    avanzar(1_000)
    expect(onDue).toHaveBeenCalledTimes(1)
  })

  it('salir de done también suspende; un worker que no terminó no cuenta', () => {
    const { result, rerender, onDue } = montar({ status: 'working', keepOpen: false, busy: false })
    expect(result.current.phase).toBe('off')
    avanzar(200_000)
    rerender({ status: 'done', keepOpen: false, busy: false })
    avanzar(50_000)
    rerender({ status: 'needs_input', keepOpen: false, busy: false })
    avanzar(200_000)
    expect(onDue).not.toHaveBeenCalled()
  })

  it('formato m:ss, nunca por debajo de 0:00', () => {
    expect(formatAutoCloseCountdown(120_000)).toBe('2:00')
    expect(formatAutoCloseCountdown(61_000)).toBe('1:01')
    expect(formatAutoCloseCountdown(500)).toBe('0:01')
    expect(formatAutoCloseCountdown(-5)).toBe('0:00')
  })

  it('la duración es 120 s salvo el override del e2e', () => {
    expect(autoCloseDurationMs()).toBe(120_000)
    ;(window as unknown as { orchestration: unknown }).orchestration = { autoCloseMs: 3_000 }
    expect(autoCloseDurationMs()).toBe(3_000)
    ;(window as unknown as { orchestration: unknown }).orchestration = { autoCloseMs: null }
    expect(autoCloseDurationMs()).toBe(120_000)
  })
})
