// src/tutorial/DemoProvider.tsx
import { useRef, useState, useEffect, type ReactNode } from 'react'
import { createDemoHarness, type DemoHarness } from './demo/harness'
import { createDemoState } from './demo/fixtures'

interface DemoProviderProps {
  children: ReactNode
}

/**
 * Activates the demo harness (swaps window.* / fetch / supabase for mocks) while
 * mounted, and restores everything on unmount. Children render only after the
 * harness is active so they never hit a real backend.
 */
export function DemoProvider({ children }: DemoProviderProps) {
  const harnessRef = useRef<DemoHarness | null>(null)
  const [ready, setReady] = useState(false)

  if (!harnessRef.current) {
    harnessRef.current = createDemoHarness(createDemoState())
  }

  useEffect(() => {
    const harness = harnessRef.current!
    harness.activate()
    setReady(true)
    return () => {
      harness.deactivate()
      setReady(false)
    }
  }, [])

  if (!ready) return null
  return <>{children}</>
}
