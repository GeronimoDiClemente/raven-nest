import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useMemoryPrefs, __reiniciarMemoryPrefs } from '../../hooks/useMemoryPrefs'
import { useSettings } from '../../hooks/useSettings'
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

  // Final review M4: con la lectura pendiente o fallida, una escritura guardaba los defaults
  // más el cambio encima de lo que había en disco.
  it('no escribe antes de que termine la carga', async () => {
    let soltar!: () => void
    const espera = new Promise<void>((r) => { soltar = r })
    ;(window as unknown as { settings: unknown }).settings = {
      get: vi.fn(async () => { await espera; return store }),
      set,
    }
    const { result } = renderHook(() => useMemoryPrefs())
    expect(result.current.cargadas).toBe(false)
    act(() => { result.current.actualizar((p) => ({ ...p, editor: { ...p.editor, spellcheck: true } })) })
    await new Promise((r) => setTimeout(r, 10))
    expect(set).not.toHaveBeenCalled()
    soltar()
    await waitFor(() => expect(result.current.cargadas).toBe(true))
    // Gana lo guardado: el cambio hecho a ciegas no se mezcla con lo que había en disco.
    expect(result.current.prefs.editor.fontSize).toBe(15)
    expect(set).not.toHaveBeenCalled()
  })

  it('si la lectura falla no queda cargada y no escribe nunca', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(window as unknown as { settings: unknown }).settings = {
      get: vi.fn(async () => { throw new Error('ipc caido') }),
      set,
    }
    const { result } = renderHook(() => useMemoryPrefs())
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(result.current.cargadas).toBe(false)
    expect(result.current.prefs).toEqual(DEFAULT_MEMORY_PREFS)
    act(() => { result.current.actualizar((p) => ({ ...p, editor: { ...p.editor, fontSize: 18 } })) })
    // Se ve en la sesión, pero no pisa lo que hay en disco.
    expect(result.current.prefs.editor.fontSize).toBe(18)
    await new Promise((r) => setTimeout(r, 10))
    expect(set).not.toHaveBeenCalled()
    error.mockRestore()
  })

  // Final review M5: cada hook tenía su fila (o ninguna) y get/get/set/set se cruzaban.
  it('una escritura de useSettings y otra de useMemoryPrefs seguidas conservan las dos', async () => {
    store = { voiceLanguage: 'en', keybindings: {}, hasSeenMemoriesWelcome: false }
    // get devuelve una foto y tarda: sin una fila compartida, las dos lecturas ven lo mismo
    // y el segundo set borra lo del primero.
    ;(window as unknown as { settings: unknown }).settings = {
      get: vi.fn(async () => { const foto = { ...store }; await new Promise((r) => setTimeout(r, 5)); return foto }),
      set,
    }
    const prefs = renderHook(() => useMemoryPrefs())
    const ajustes = renderHook(() => useSettings())
    await waitFor(() => expect(prefs.result.current.cargadas).toBe(true))
    await act(async () => {
      void ajustes.result.current.markMemoriesWelcomeSeen()
      prefs.result.current.actualizar((p) => ({ ...p, editor: { ...p.editor, fontSize: 17 } }))
      await new Promise((r) => setTimeout(r, 40))
    })
    expect(store).toMatchObject({ hasSeenMemoriesWelcome: true, memoryPrefs: { editor: { fontSize: 17 } } })
  })
})
