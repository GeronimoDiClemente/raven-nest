// `speech.onStatus` hacía `removeAllListeners` antes de suscribir y el hook se daba de baja
// con `removeStatusListener()` (todo el canal), compensado con un contador de montajes. Ahora
// cada instancia usa su propia baja: desmontar una no deja sorda a la otra.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'

type Cb = (status: 'loading' | 'ready') => void
const oyentes = new Set<Cb>()
const removeStatusListener = vi.fn(() => oyentes.clear())

beforeEach(() => {
  oyentes.clear()
  removeStatusListener.mockClear()
  ;(window as unknown as { speech: unknown }).speech = {
    onStatus: (cb: Cb) => { oyentes.add(cb); return () => { oyentes.delete(cb) } },
    removeStatusListener,
    transcribe: vi.fn(),
  }
})

const emitir = (s: 'loading' | 'ready') => act(() => { for (const cb of [...oyentes]) cb(s) })

describe('useSpeechRecognition · oyente de estado', () => {
  it('desmontar una instancia no deja sorda a la otra', () => {
    const a = renderHook(() => useSpeechRecognition(() => {}))
    const b = renderHook(() => useSpeechRecognition(() => {}))
    expect(oyentes.size).toBe(2)

    a.unmount()
    expect(removeStatusListener).not.toHaveBeenCalled()
    expect(oyentes.size).toBe(1)

    emitir('loading')
    expect(b.result.current.isModelLoading).toBe(true)
    emitir('ready')
    expect(b.result.current.isModelLoading).toBe(false)

    b.unmount()
    expect(oyentes.size).toBe(0)
  })
})
