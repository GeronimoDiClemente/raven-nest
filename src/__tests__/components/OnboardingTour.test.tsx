// src/__tests__/components/OnboardingTour.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OnboardingTour } from '../../tutorial/OnboardingTour'
import type { TourStep } from '../../tutorial/types'

const steps: TourStep[] = [
  { id: 's1', anchor: '[data-tour-id="a"]', title: { en: 'Step one', es: 'Paso uno' }, body: { en: 'First', es: 'Primero' } },
  { id: 's2', anchor: '[data-tour-id="b"]', title: { en: 'Step two', es: 'Paso dos' }, body: { en: 'Second', es: 'Segundo' } },
]

describe('OnboardingTour navigation', () => {
  it('shows the first step and a progress badge', () => {
    render(<OnboardingTour steps={steps} onClose={() => {}} />)
    expect(screen.getByText('Step one')).toBeInTheDocument()
    expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument()
  })

  it('Next advances to the second step', () => {
    render(<OnboardingTour steps={steps} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText('Step two')).toBeInTheDocument()
  })

  it('Next on the last step calls onClose (finish)', () => {
    const onClose = vi.fn()
    render(<OnboardingTour steps={steps} onClose={onClose} startIndex={1} />)
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Skip calls onClose immediately', () => {
    const onClose = vi.fn()
    render(<OnboardingTour steps={steps} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('advances when the anchored element is clicked on an advanceOnClick step', () => {
    const clickSteps: TourStep[] = [
      { id: 's1', anchor: '[data-tour-id="go"]', title: { en: 'Click it', es: 'Tocalo' }, body: { en: 'x', es: 'x' }, advanceOnClick: true },
      { id: 's2', anchor: '[data-tour-id="b"]', title: { en: 'Step two', es: 'Paso dos' }, body: { en: 'y', es: 'y' } },
    ]
    document.body.innerHTML = '<button data-tour-id="go">Go</button>'
    render(<OnboardingTour steps={clickSteps} onClose={() => {}} />)
    fireEvent.click(document.querySelector('[data-tour-id="go"]') as Element)
    expect(screen.getByText('Step two')).toBeInTheDocument()
  })
})
