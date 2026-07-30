// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTourSeen } from '../../hooks/useTourSeen'

describe('useTourSeen', () => {
  beforeEach(() => {
    // Create a mock localStorage implementation
    const store: Record<string, string> = {}
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key]
      }),
      clear: vi.fn(() => {
        Object.keys(store).forEach(key => delete store[key])
      }),
      key: vi.fn((index: number) => Object.keys(store)[index] || null),
      get length() {
        return Object.keys(store).length
      },
    }

    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    })
  })

  it('starts unseen when no flag is stored', () => {
    const { result } = renderHook(() => useTourSeen('activation'))
    expect(result.current.seen).toBe(false)
  })

  it('markSeen sets the flag and persists it', () => {
    const { result } = renderHook(() => useTourSeen('activation'))
    act(() => result.current.markSeen())
    expect(result.current.seen).toBe(true)
    expect(localStorage.getItem('nest:tour-seen:activation')).toBe('1')
  })

  it('reads an existing stored flag as seen', () => {
    localStorage.setItem('nest:tour-seen:teams', '1')
    const { result } = renderHook(() => useTourSeen('teams'))
    expect(result.current.seen).toBe(true)
  })

  it('reset clears the flag', () => {
    localStorage.setItem('nest:tour-seen:teams', '1')
    const { result } = renderHook(() => useTourSeen('teams'))
    act(() => result.current.reset())
    expect(result.current.seen).toBe(false)
    expect(localStorage.getItem('nest:tour-seen:teams')).toBeNull()
  })
})
