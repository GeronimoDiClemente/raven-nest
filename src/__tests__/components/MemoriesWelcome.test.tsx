import { render, screen, fireEvent } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import MemoriesWelcome from '../../components/MemoriesWelcome'
import { memoriesTour } from '../../tutorial/tours/memories'

it('el botón dice la cantidad real de pasos del tour', () => {
  render(<MemoriesWelcome onTour={() => {}} onSkip={() => {}} />)
  expect(screen.getByRole('button', { name: `Show me around · ${memoriesTour.steps.length} steps` })).toBeInTheDocument()
})

it('muestra la escena y los cuatro usos, y ofrece tour o saltar', () => {
  const onTour = vi.fn(); const onSkip = vi.fn()
  render(<MemoriesWelcome onTour={onTour} onSkip={onSkip} />)
  expect(screen.getByRole('dialog', { name: 'Your agents stop starting from zero' })).toBeInTheDocument()
  for (const uso of ['Just for you', 'On all your machines', 'With your team', 'Outside Nest']) {
    expect(screen.getByText(uso)).toBeInTheDocument()
  }
  fireEvent.click(screen.getByRole('button', { name: /Show me around/ }))
  expect(onTour).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /Skip/ }))
  expect(onSkip).toHaveBeenCalled()
})
