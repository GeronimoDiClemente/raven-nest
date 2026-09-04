import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MemoryAdoptionDialog from '../../components/MemoryAdoptionDialog'

describe('MemoryAdoptionDialog', () => {
  it('shows the count and the projects it came from', () => {
    render(<MemoryAdoptionDialog count={7} projects={['Alfa', 'Zeta']} onAdopt={vi.fn()} onDecline={vi.fn()} />)

    expect(screen.getByText(/we found 7 memories/i)).toBeInTheDocument()
    expect(screen.getByText(/Alfa, Zeta/)).toBeInTheDocument()
  })

  it('singular wording for exactly one memory', () => {
    render(<MemoryAdoptionDialog count={1} projects={['Alfa']} onAdopt={vi.fn()} onDecline={vi.fn()} />)

    expect(screen.getByText(/we found 1 memory /i)).toBeInTheDocument()
  })

  it('omits the project line when there are none (e.g. only the global project)', () => {
    render(<MemoryAdoptionDialog count={2} projects={[]} onAdopt={vi.fn()} onDecline={vi.fn()} />)

    expect(screen.queryByText(/^From /)).not.toBeInTheDocument()
  })

  it('"Yes, these are mine" calls onAdopt', () => {
    const onAdopt = vi.fn()
    render(<MemoryAdoptionDialog count={3} projects={['Alfa']} onAdopt={onAdopt} onDecline={vi.fn()} />)

    fireEvent.click(screen.getByText('Yes, these are mine'))
    expect(onAdopt).toHaveBeenCalled()
  })

  it('"Not mine" calls onDecline, and says nothing gets deleted', () => {
    const onDecline = vi.fn()
    render(<MemoryAdoptionDialog count={3} projects={['Alfa']} onAdopt={vi.fn()} onDecline={onDecline} />)

    expect(screen.getByText(/nothing gets deleted/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Not mine'))
    expect(onDecline).toHaveBeenCalled()
  })
})
