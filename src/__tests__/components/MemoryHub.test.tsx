import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MemoryHub from '../../components/MemoryHub'
import { CLOUD_MONTHLY_PRICE } from '../../lib/stripe'

function mockHubStats(stats: { itemCount: number; projectCount: number }) {
  ;(window as unknown as { memory: { hubStats: ReturnType<typeof vi.fn> } }).memory = {
    hubStats: vi.fn().mockResolvedValue(stats),
  }
}

describe('MemoryHub', () => {
  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
  })

  it('opens on the recognition screen with the real import numbers', async () => {
    mockHubStats({ itemCount: 42, projectCount: 5 })
    render(<MemoryHub onClose={vi.fn()} onUpgrade={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/42/)).toBeInTheDocument())
    expect(screen.getByText(/5/)).toBeInTheDocument()
  })

  it('falls back to a generic message when there is nothing imported yet', async () => {
    mockHubStats({ itemCount: 0, projectCount: 0 })
    render(<MemoryHub onClose={vi.fn()} onUpgrade={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/starts capturing/i)).toBeInTheDocument())
  })

  it('Next advances through the 3 screens, ending on the Cloud pricing screen', async () => {
    mockHubStats({ itemCount: 42, projectCount: 5 })
    render(<MemoryHub onClose={vi.fn()} onUpgrade={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/42/)).toBeInTheDocument())
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText(/local-first/i)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText(new RegExp(`\\$${CLOUD_MONTHLY_PRICE}`))).toBeInTheDocument()
  })

  it('Skip closes the hub from any screen', async () => {
    mockHubStats({ itemCount: 42, projectCount: 5 })
    const onClose = vi.fn()
    render(<MemoryHub onClose={onClose} onUpgrade={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/42/)).toBeInTheDocument())
    fireEvent.click(screen.getByText('Skip'))
    expect(onClose).toHaveBeenCalled()
  })

  it('the Cloud screen CTA calls onUpgrade instead of running checkout itself', async () => {
    mockHubStats({ itemCount: 42, projectCount: 5 })
    const onUpgrade = vi.fn()
    render(<MemoryHub onClose={vi.fn()} onUpgrade={onUpgrade} />)

    await waitFor(() => expect(screen.getByText(/42/)).toBeInTheDocument())
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('See plans'))

    expect(onUpgrade).toHaveBeenCalled()
  })
})
