// src/tutorial/OnboardingTour.tsx
import { useState, useCallback } from 'react'
import type { TourStep } from './types'

export interface OnboardingTourProps {
  steps: TourStep[]
  onClose: () => void
  startIndex?: number
}

export function OnboardingTour({ steps, onClose, startIndex = 0 }: OnboardingTourProps) {
  const [index, setIndex] = useState(startIndex)
  const step = steps[index]
  const isLast = index === steps.length - 1

  const next = useCallback(() => {
    if (isLast) onClose()
    else setIndex((i) => i + 1)
  }, [isLast, onClose])

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  if (!step) return null

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label="Tutorial">
      <div className="tour-dim" />
      <div className="tour-tooltip" style={{ zIndex: 2001 }}>
        <span className="tour-badge">
          {index + 1} / {steps.length}
        </span>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-controls">
          <button className="tour-back" onClick={back} disabled={index === 0}>
            Atrás
          </button>
          <span className="tour-spacer" />
          <button className="tour-skip" onClick={onClose}>
            Saltar tour
          </button>
          <button className="tour-next" onClick={next}>
            {isLast ? 'Listo' : 'Siguiente →'}
          </button>
        </div>
        <div className="tour-progress">
          {steps.map((s, i) => (
            <i key={s.id} className={i === index ? 'on' : ''} />
          ))}
        </div>
      </div>
    </div>
  )
}
