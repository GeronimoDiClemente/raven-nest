// PaneHeader renders the "Hand off →" action that advances a cooperative worker
// pipeline to its next step. The button is visibility-gated on `hasNextStep`
// (App computes it from the active worker run) and fires `onHandoff` on click.
// PaneHeader has no window/IPC deps on mount (PortChipsGroup returns null for
// ports=[], ConfirmDialog only mounts on close) so it renders standalone.
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import PaneHeader from '../../components/PaneHeader'
import type { PaneNode } from '../../types'

const basePane = {
  id: 'p1',
  aiType: 'claude',
  accountName: 'gero',
  accountDir: '/home/gero',
  borderColor: '#0066FF',
  cmd: 'claude',
  repoPath: '/tmp/wt',
} as unknown as PaneNode

function renderHeader(extra: Partial<ComponentProps<typeof PaneHeader>> = {}) {
  return render(
    <PaneHeader
      pane={basePane}
      zoomed={false}
      onZoom={vi.fn()}
      onClose={vi.fn()}
      onColorChange={vi.fn()}
      onNoteChange={vi.fn()}
      {...extra}
    />,
  )
}

describe('<PaneHeader> — Hand off →', () => {
  it('renders the "Hand off" button when hasNextStep and calls onHandoff on click', () => {
    const onHandoff = vi.fn()
    renderHeader({ hasNextStep: true, onHandoff })

    const btn = screen.getByRole('button', { name: /hand off/i })
    expect(btn).toBeInTheDocument()

    fireEvent.click(btn)
    expect(onHandoff).toHaveBeenCalledTimes(1)
  })

  it('does not render the button when hasNextStep is false (single-step workers never arm it)', () => {
    renderHeader({ hasNextStep: false, onHandoff: vi.fn() })
    expect(screen.queryByRole('button', { name: /hand off/i })).not.toBeInTheDocument()
  })

  it('does not render the button when hasNextStep is undefined (no worker running)', () => {
    renderHeader()
    expect(screen.queryByRole('button', { name: /hand off/i })).not.toBeInTheDocument()
  })
})
