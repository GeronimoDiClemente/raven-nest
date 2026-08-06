// @vitest-environment jsdom
// IntegrationsHub mounts the orchestration board (useBoardRows + OrchestrationBoard)
// inside the teams-workspace overlay shell. Mock the same window bridges
// useBoardRows needs (pattern from hooks/useBoardRows.test.tsx) so the hook
// resolves without touching real IPC.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../hooks/useInstalledPlugins', () => ({
  useInstalledPlugins: () => ({ installed: [] }),
}))

import { IntegrationsHub } from '../../components/IntegrationsHub'

beforeEach(() => {
  Object.assign(window as unknown as Record<string, unknown>, {
    tickets: {
      list: vi.fn().mockResolvedValue([]),
      tracked: vi.fn().mockResolvedValue([]),
    },
    worktree: { listAll: vi.fn().mockResolvedValue({ ok: true, worktrees: [] }) },
    signals: { list: vi.fn().mockResolvedValue([]), onUpdate: vi.fn(() => () => {}) },
  })
})

describe('IntegrationsHub', () => {
  it('shows the Integrations header and the board empty state', async () => {
    render(<IntegrationsHub onClose={vi.fn()} />)

    expect(screen.getByText('Integrations')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('No tasks yet — connect a source.')).toBeInTheDocument())
  })

  it('calls onClose when the back button is clicked', async () => {
    const onClose = vi.fn()
    render(<IntegrationsHub onClose={onClose} />)

    await waitFor(() => expect(screen.getByText('No tasks yet — connect a source.')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Back'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
