// src/tutorial/OnboardingTour.tsx
import { useState, useEffect, useCallback, type CSSProperties, type RefObject } from 'react'
import type { TourStep } from './types'

export interface OnboardingTourProps {
  steps: TourStep[]
  onClose: () => void
  startIndex?: number
  /**
   * Scope anchor lookups to this element's subtree instead of the whole
   * document. Required when the tour runs over a live app that renders the
   * SAME `data-tour-id` anchors (e.g. the tutorial sandbox): without it,
   * `document.querySelector` would resolve to the background app's duplicate
   * anchor (hidden under the overlay) instead of the sandbox's.
   */
  rootRef?: RefObject<HTMLElement | null>
}

export function OnboardingTour({ steps, onClose, startIndex = 0, rootRef }: OnboardingTourProps) {
  const [index, setIndex] = useState(startIndex)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = steps[index]
  const isLast = index === steps.length - 1

  const next = useCallback(() => {
    if (isLast) onClose()
    else setIndex((i) => i + 1)
  }, [isLast, onClose])

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // Track the anchored element's box; recompute on resize/scroll.
  useEffect(() => {
    if (!step) return
    const update = () => {
      const scope: ParentNode = rootRef?.current ?? document
      const el = scope.querySelector(step.anchor)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [step, rootRef])

  // Click-to-advance: clicking the anchored element advances the step.
  useEffect(() => {
    if (!step?.advanceOnClick) return
    const scope: ParentNode = rootRef?.current ?? document
    const el = scope.querySelector(step.anchor)
    if (!el) return
    const handler = () => next()
    el.addEventListener('click', handler)
    return () => el.removeEventListener('click', handler)
  }, [step, next, rootRef])

  if (!step) return null

  const pad = 6
  const spotlight = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null

  // Tooltip sits just below the spotlight (fallback: centered).
  const tooltipStyle: CSSProperties = spotlight
    ? { position: 'fixed', top: spotlight.top + spotlight.height + 12, left: spotlight.left, zIndex: 2001 }
    : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 2001 }

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label="Tutorial">
      <div className="tour-dim" />
      {spotlight && (
        <div
          className="tour-spotlight"
          style={{ top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height }}
        />
      )}
      <div className="tour-tooltip" style={tooltipStyle}>
        <span className="tour-badge">
          {index + 1} / {steps.length}
        </span>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        {step.advanceOnClick && <div className="tour-hint">o tocá el elemento resaltado</div>}
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
