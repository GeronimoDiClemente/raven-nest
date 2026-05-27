// src/__tests__/components/OnboardingTour.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OnboardingTour } from '../../tutorial/OnboardingTour'
import type { TourStep } from '../../tutorial/types'

const steps: TourStep[] = [
  { id: 's1', anchor: '[data-tour-id="a"]', title: 'Step one', body: 'First' },
  { id: 's2', anchor: '[data-tour-id="b"]', title: 'Step two', body: 'Second' },
]

describe('OnboardingTour navigation', () => {
  it('shows the first step and a progress badge', () => {
    render(<OnboardingTour steps={steps} onClose={() => {}} />)
    expect(screen.getByText('Step one')).toBeInTheDocument()
    expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument()
  })

  it('Next advances to the second step', () => {
    render(<OnboardingTour steps={steps} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /siguiente/i }))
    expect(screen.getByText('Step two')).toBeInTheDocument()
  })

  it('Next on the last step calls onClose (finish)', () => {
    const onClose = vi.fn()
    render(<OnboardingTour steps={steps} onClose={onClose} startIndex={1} />)
    fireEvent.click(screen.getByRole('button', { name: /finalizar|terminar|listo/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Skip calls onClose immediately', () => {
    const onClose = vi.fn()
    render(<OnboardingTour steps={steps} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /saltar/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
