// src/tutorial/TutorialController.tsx
import { useState, useEffect, useCallback } from 'react'
import { OnboardingTour } from './OnboardingTour'
import { DemoProvider } from './DemoProvider'
import { DemoActivationStage } from './DemoActivationStage'
import { getTour } from './registry'
import { useTourSeen } from '../hooks/useTourSeen'
import type { TourId } from './types'

/** Fire to open a tour imperatively: window.dispatchEvent(new CustomEvent('nest:open-tour', { detail: 'activation' })) */
const OPEN_EVENT = 'nest:open-tour'

export function openTour(id: TourId): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }))
}

export function TutorialController() {
  const [openId, setOpenId] = useState<TourId | null>(null)
  const activation = useTourSeen('activation')

  // Auto-launch activation on first run.
  useEffect(() => {
    if (!activation.seen) setOpenId('activation')
  }, [activation.seen])

  // Imperative open (Help buttons).
  useEffect(() => {
    const handler = (e: Event) => setOpenId((e as CustomEvent<TourId>).detail)
    window.addEventListener(OPEN_EVENT, handler)
    return () => window.removeEventListener(OPEN_EVENT, handler)
  }, [])

  const close = useCallback(() => {
    if (openId === 'activation') activation.markSeen()
    setOpenId(null)
  }, [openId, activation])

  if (!openId) return null
  const tour = getTour(openId)
  if (!tour) return null

  return (
    <DemoProvider>
      {openId === 'activation' && <DemoActivationStage />}
      <OnboardingTour steps={tour.steps} onClose={close} />
    </DemoProvider>
  )
}
