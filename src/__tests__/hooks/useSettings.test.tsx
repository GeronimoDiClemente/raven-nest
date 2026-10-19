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
