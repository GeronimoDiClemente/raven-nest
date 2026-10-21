// Spec 2b-1 §4.1: con Free conectando, «Local memory active — cloud sync is a Cloud feature»
// queda sólo para un plan que esta versión no conoce (decisión D8). useProfile normaliza a los
// planes conocidos, así que se fuerza con un mock — por eso va en su propio archivo.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import CloudMemoryCard from '../../components/CloudMemoryCard'

const supabaseMock = vi.hoisted(() => {
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
  }
  return {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null } })), signOut: vi.fn(), getSession: vi.fn() },
    from: vi.fn(() => query),
  }
})
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))
vi.mock('../../hooks/useProfile', () => ({
  useProfile: () => ({ plan: 'legacy', loading: false, isTrialActive: false, trialDaysLeft: 0 }),
}))

afterEach(() => { delete (window as unknown as { memory?: unknown }).memory })

describe('CloudMemoryCard — un plan que esta versión no conoce', () => {
  it('no ofrece Connect y dice que la nube es de Cloud', async () => {
    ;(window as unknown as { localPaths: { getAll: () => Promise<Record<string, string>> } }).localPaths = { getAll: async () => ({}) }
    ;(window as unknown as { memory: unknown }).memory = {
      ensureDeviceId: vi.fn().mockResolvedValue('dev-1'),
      status: vi.fn().mockResolvedValue({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' }),
      hubStats: vi.fn().mockResolvedValue({ itemCount: 0, projectCount: 0 }),
      onStatus: vi.fn(),
      removeStatusListener: vi.fn(),
    }
    render(<CloudMemoryCard />)

    expect(await screen.findByText('Local memory active — cloud sync is a Cloud feature')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })
})
