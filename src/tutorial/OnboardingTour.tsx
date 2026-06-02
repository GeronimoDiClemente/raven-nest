// src/tutorial/OnboardingTour.tsx
import { useState, useEffect, useLayoutEffect, useRef, useCallback, type CSSProperties, type RefObject } from 'react'
import type { TourStep } from './types'
import { t, resolveTutorialLocale, type Localized } from './i18n'
import { computeTooltipPosition } from './tooltipPosition'

/** Action signal: bumping `nonce` advances the step whose `advanceOnAction` === `action`. */
export interface AdvanceSignal {
  action: string
  nonce: number
}

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
  /**
   * Drives action-based advancing. When `nonce` changes and the current step's
   * `advanceOnAction` matches `action`, the tour advances. Optional: when
   * absent the tour advances only via the anchor click or the Next button.
   *
   * Note: a signal fired while the current step's `advanceOnAction` does NOT
   * match is consumed (marked seen) and will NOT retroactively advance a later
   * matching step — so emitters should only fire a signal while its matching
   * step is active (the Next button is always the fallback).
   */
  advanceSignal?: AdvanceSignal | null
  /** Notifies the parent of the current step's id whenever it changes. */
  onStepChange?: (stepId: string) => void
}

const LABELS: Record<'back' | 'skip' | 'next' | 'done' | 'hint', Localized> = {
  back: { en: 'Back', es: 'Atrás' },
  skip: { en: 'Skip', es: 'Saltar' },
  next: { en: 'Next →', es: 'Siguiente →' },
  done: { en: 'Done', es: 'Listo' },
  hint: { en: 'or click the highlighted element', es: 'o tocá el elemento resaltado' },
}

export function OnboardingTour({ steps, onClose, startIndex = 0, rootRef, advanceSignal, onStepChange }: OnboardingTourProps) {
  // Locale is snapshotted per render; no event re-renders on a mid-session OS language change (acceptable).
  const locale = resolveTutorialLocale()
  const [index, setIndex] = useState(startIndex)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const [ttSize, setTtSize] = useState({ w: 260, h: 170 })
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

  // Action-to-advance: a fresh signal whose action matches the current step
  // advances it. We mark every nonce as seen (even non-matching) so a stale
  // signal can't fire later when we reach a step that would match it.
  const lastNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!advanceSignal) return
    if (lastNonce.current === advanceSignal.nonce) return
    lastNonce.current = advanceSignal.nonce
    if (step?.advanceOnAction && step.advanceOnAction === advanceSignal.action) {
      next()
    }
  }, [advanceSignal, step, next])

  // Report the active step's id so a parent can react (e.g. close panels that
  // would cover anchors on later steps).
  useEffect(() => {
    if (step) onStepChange?.(step.id)
  }, [step, onStepChange])

  // Measure the rendered tooltip so placement math can keep it inside the
  // viewport. Bails out (returns prev) when unchanged so it doesn't re-render.
  useLayoutEffect(() => {
    const el = tooltipRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setTtSize((prev) =>
      r.width && r.height && (Math.abs(r.width - prev.w) > 1 || Math.abs(r.height - prev.h) > 1)
        ? { w: r.width, h: r.height }
        : prev,
    )
  }, [step, rect])

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

  // Position the tooltip beside/above/below the spotlight per step.placement,
  // clamped inside the viewport (fallback: centered when there's no anchor).
  const tooltipStyle: CSSProperties = spotlight
    ? (() => {
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
        const vh = typeof window !== 'undefined' ? window.innerHeight : 768
        const { top, left } = computeTooltipPosition(spotlight, step.placement, ttSize, { w: vw, h: vh })
        return { position: 'fixed', top, left, zIndex: 2001 }
      })()
    : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 2001 }

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label="Tutorial">
      {/* When a spotlight is shown its box-shadow already dims everything
          OUTSIDE the cutout, so the focused element stays bright. A separate
          full dim would re-darken the cutout too ("can't see the focus"), so
          only use it as the fallback when there's no anchor to spotlight. */}
      {spotlight ? (
        <div
          className="tour-spotlight"
          style={{ top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-tooltip" style={tooltipStyle} ref={tooltipRef}>
        <span className="tour-badge">
          {index + 1} / {steps.length}
        </span>
        <h3 className="tour-title">{t(step.title, locale)}</h3>
        <p className="tour-body">{t(step.body, locale)}</p>
        {step.advanceOnClick && <div className="tour-hint">{t(LABELS.hint, locale)}</div>}
        <div className="tour-controls">
          <button className="tour-back" onClick={back} disabled={index === 0}>
            {t(LABELS.back, locale)}
          </button>
          <span className="tour-spacer" />
          <button className="tour-skip" onClick={onClose}>
            {t(LABELS.skip, locale)}
          </button>
          <button className="tour-next" onClick={next}>
            {isLast ? t(LABELS.done, locale) : t(LABELS.next, locale)}
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
