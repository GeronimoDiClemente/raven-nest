import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useMemoryPrefs, __reiniciarMemoryPrefs } from '../../hooks/useMemoryPrefs'
import { DEFAULT_MEMORY_PREFS } from '../../lib/memory-prefs'

let store: Record<string, unknown>
const set = vi.fn(async (d: Record<string, unknown>) => { store = d })
beforeEach(() => {
  __reiniciarMemoryPrefs()
  store = { voiceLanguage: 'en', otro: 1, memoryPrefs: { editor: { fontSize: 15 } } }
  set.mockClear()
  ;(window as unknown as { settings: unknown }).settings = { get: vi.fn(async () => store), set }
})
afterEach(() => { delete (window as unknown as { settings?: unknown }).settings })

describe('useMemoryPrefs', () => {
  it('carga lo guardado con merge contra los defaults', async () => {
    const { result } = renderHook(() => useMemoryPrefs())
    expect(result.current.cargadas).toBe(false)
    await waitFor(() => expect(result.current.cargadas).toBe(true))
    expect(result.current.prefs.editor).toEqual({ ...DEFAULT_MEMORY_PREFS.editor, fontSize: 15 })
  })

  it('actualizar escribe sólo memoryPrefs, sobre lo que está guardado ahora', async () => {
    const { result } = renderHook(() => useMemoryPrefs())
    await waitFor(() => expect(result.current.cargadas).toBe(true))
    store = { ...store, voiceLanguage: 'es' } // otra instancia cambió el idioma
    act(() => { result.current.actualizar((p) => ({ ...p, editor: { ...p.editor, spellcheck: true } })) })
    expect(result.current.prefs.editor.spellcheck).toBe(true)
    await waitFor(() => expect(set).toHaveBeenCalled())
    expect(store).toMatchObject({ voiceLanguage: 'es', otro: 1, memoryPrefs: { editor: { spellcheck: true, fontSize: 15 } } })
  })

  it('la segunda apertura en la misma sesión arranca cargada, sin esperar al preload', async () => {
    const a = renderHook(() => useMemoryPrefs())
    await waitFor(() => expect(a.result.current.cargadas).toBe(true))
    a.unmount()
    const b = renderHook(() => useMemoryPrefs())
    expect(b.result.current.cargadas).toBe(true)
    expect(b.result.current.prefs.editor.fontSize).toBe(15)
  })

  it('sin window.settings (tests, renderer fuera de Electron) da los defaults y no rompe', async () => {
    delete (window as unknown as { settings?: unknown }).settings
    const { result } = renderHook(() => useMemoryPrefs())
    await waitFor(() => expect(result.current.cargadas).toBe(true))
    expect(result.current.prefs).toEqual(DEFAULT_MEMORY_PREFS)
    act(() => { result.current.actualizar((p) => ({ ...p, editor: { ...p.editor, fontSize: 18 } })) })
    expect(result.current.prefs.editor.fontSize).toBe(18)
  })
})
