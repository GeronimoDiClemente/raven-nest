import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSettings } from '../../hooks/useSettings'

describe('useSettings — hasSeenMemoryHub', () => {
  beforeEach(() => {
    ;(window as unknown as { settings: unknown }).settings = {
      get: vi.fn().mockResolvedValue({ voiceLanguage: 'en', hasSeenMemoryHub: false, keybindings: {} }),
      set: vi.fn().mockResolvedValue(undefined),
    }
  })

  it('loads hasSeenMemoryHub from window.settings.get()', async () => {
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.settings.hasSeenMemoryHub).toBe(false))
  })

  it('markMemoryHubSeen persists true and updates local state', async () => {
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.settings.hasSeenMemoryHub).toBe(false))

    await act(async () => {
      await result.current.markMemoryHubSeen()
    })

    expect(result.current.settings.hasSeenMemoryHub).toBe(true)
    expect(window.settings.set).toHaveBeenCalledWith(expect.objectContaining({ hasSeenMemoryHub: true }))
  })
})

describe('useSettings — hasSeenMemoriesWelcome', () => {
  beforeEach(() => {
    ;(window as unknown as { settings: unknown }).settings = {
      get: vi.fn().mockResolvedValue({ voiceLanguage: 'en', hasSeenMemoriesWelcome: false, keybindings: {} }),
      set: vi.fn().mockResolvedValue(undefined),
    }
  })

  it('loads hasSeenMemoriesWelcome from window.settings.get()', async () => {
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.settings.hasSeenMemoriesWelcome).toBe(false))
  })

  it('markMemoriesWelcomeSeen persists true and updates local state', async () => {
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.settings.hasSeenMemoriesWelcome).toBe(false))

    await act(async () => {
      await result.current.markMemoriesWelcomeSeen()
    })

    expect(result.current.settings.hasSeenMemoriesWelcome).toBe(true)
    expect(window.settings.set).toHaveBeenCalledWith(expect.objectContaining({ hasSeenMemoriesWelcome: true }))
  })
})

describe('useSettings — memoryPrefs', () => {
  it('carga memoryPrefs con merge contra los defaults', async () => {
    ;(window as unknown as { settings: unknown }).settings = {
      get: vi.fn().mockResolvedValue({ voiceLanguage: 'en', keybindings: {}, memoryPrefs: { editor: { fontSize: 16 } } }),
      set: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.settings.memoryPrefs.editor.fontSize).toBe(16))
    expect(result.current.settings.memoryPrefs.editor.livePreview).toBe(true)
  })

  it('cambiar el idioma no pisa las memoryPrefs guardadas', async () => {
    const guardadas = { editor: { livePreview: false }, graph: { remember: false } }
    const set = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { settings: unknown }).settings = {
      get: vi.fn().mockResolvedValue({ voiceLanguage: 'en', keybindings: {}, memoryPrefs: guardadas }),
      set,
    }
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.settings.voiceLanguage).toBe('en'))
    await act(async () => { await result.current.updateVoiceLanguage('es') })
    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({ voiceLanguage: 'es', memoryPrefs: guardadas }))
  })

  it('una instancia montada desde antes no pisa lo que otra guardó después', async () => {
    let store: Record<string, unknown> = { voiceLanguage: 'en', keybindings: {}, hasSeenMemoriesWelcome: false }
    const get = vi.fn(async () => store)
    ;(window as unknown as { settings: unknown }).settings = {
      get,
      set: vi.fn(async (d: Record<string, unknown>) => { store = d }),
    }
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(get).toHaveBeenCalled())
    // useMemoryPrefs escribió mientras tanto (por ejemplo, desde Memories).
    store = { ...store, memoryPrefs: { editor: { fontSize: 16 } } }
    await act(async () => { await result.current.markMemoriesWelcomeSeen() })
    expect(store).toMatchObject({ hasSeenMemoriesWelcome: true, memoryPrefs: { editor: { fontSize: 16 } } })
  })
})
