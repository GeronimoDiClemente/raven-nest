// src/__tests__/components/activation-tour.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TutorialController, openTour } from '../../tutorial/TutorialController'

describe('activation tour end-to-end (demo mode)', () => {
  beforeEach(() => {
    localStorage.clear()
    // Sentinel real APIs that must NEVER be called during the tour.
    ;(window as unknown as { git: unknown }).git = { listBranches: vi.fn(() => { throw new Error('real git called') }) }
    ;(window as unknown as { fetch: unknown }).fetch = vi.fn(() => { throw new Error('real fetch called') })
  })

  it('auto-launches on first run and walks every step via Next', async () => {
    render(<TutorialController />)
    await waitFor(() => expect(screen.getByText('Creá tu primer pane')).toBeInTheDocument())

    // Next through all 5 steps; the last button says "Listo".
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: /siguiente/i }))
    }
    expect(screen.getByText(/Workspaces en tabs/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /listo/i }))

    // Marked seen → does not re-open.
    await waitFor(() => expect(screen.queryByText('Creá tu primer pane')).not.toBeInTheDocument())
    expect(localStorage.getItem('nest:tour-seen:activation')).toBe('1')
  })

  it('Help opener re-launches the tour after it was seen', async () => {
    localStorage.setItem('nest:tour-seen:activation', '1')
    render(<TutorialController />)
    expect(screen.queryByText('Creá tu primer pane')).not.toBeInTheDocument()
    openTour('activation')
    await waitFor(() => expect(screen.getByText('Creá tu primer pane')).toBeInTheDocument())
  })
})
