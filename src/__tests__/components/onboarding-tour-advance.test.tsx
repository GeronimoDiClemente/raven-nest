// src/__tests__/components/onboarding-tour-advance.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { OnboardingTour } from '../../tutorial/OnboardingTour'
import type { TourStep } from '../../tutorial/types'

const steps: TourStep[] = [
  { id: 's1', anchor: '[data-tour-id="nope-1"]', title: { en: 'First', es: 'Primero' }, body: { en: 'Step one body', es: 'Cuerpo uno' } },
  { id: 's2', anchor: '[data-tour-id="nope-2"]', title: { en: 'Drop here', es: 'Soltá acá' }, body: { en: 'Drop step body', es: 'Cuerpo drop' }, advanceOnAction: 'drop' },
  { id: 's3', anchor: '[data-tour-id="nope-3"]', title: { en: 'Last', es: 'Último' }, body: { en: 'Last body', es: 'Cuerpo final' } },
]

beforeEach(() => {
  Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
})

describe('OnboardingTour engine', () => {
  it('renders English engine labels', () => {
    render(<OnboardingTour steps={steps} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
  })

  it('renders English copy + labels even when the browser locale is Spanish', () => {
    Object.defineProperty(navigator, 'language', { value: 'es-AR', configurable: true })
    render(<OnboardingTour steps={steps} onClose={() => {}} />)
    expect(screen.getByText('Step one body')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument()
  })

  it('advances on a matching action signal only', () => {
    const { rerender } = render(
      <OnboardingTour steps={steps} onClose={() => {}} advanceSignal={null} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText('Drop step body')).toBeInTheDocument()

    rerender(<OnboardingTour steps={steps} onClose={() => {}} advanceSignal={{ action: 'sync', nonce: 1 }} />)
    expect(screen.getByText('Drop step body')).toBeInTheDocument()

    rerender(<OnboardingTour steps={steps} onClose={() => {}} advanceSignal={{ action: 'drop', nonce: 2 }} />)
    expect(screen.getByText('Last body')).toBeInTheDocument()
  })

  it('finishing the last step calls onClose', () => {
    const onClose = vi.fn()
    render(<OnboardingTour steps={steps} onClose={onClose} startIndex={2} />)
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('reports the current step id via onStepChange', () => {
    const onStepChange = vi.fn()
    render(<OnboardingTour steps={steps} onClose={() => {}} onStepChange={onStepChange} />)
    expect(onStepChange).toHaveBeenLastCalledWith('s1')
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(onStepChange).toHaveBeenLastCalledWith('s2')
  })
})
