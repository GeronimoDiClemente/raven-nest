import { useState, useCallback } from 'react'

const key = (tourId: string) => `nest:tour-seen:${tourId}`

/**
 * Per-machine "has the user seen this tour" flag, backed by localStorage.
 * Mirrors the existing `nest:*` key convention (e.g. `nest:remembered-email`).
 */
export function useTourSeen(tourId: string) {
  const [seen, setSeen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key(tourId)) === '1'
    } catch {
      return false
    }
  })

  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(key(tourId), '1')
    } catch {
      // localStorage unavailable (private mode); flag stays in-memory only.
    }
    setSeen(true)
  }, [tourId])

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(key(tourId))
    } catch {
      // ignore
    }
    setSeen(false)
  }, [tourId])

  return { seen, markSeen, reset }
}
