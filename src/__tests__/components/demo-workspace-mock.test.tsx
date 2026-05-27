// src/__tests__/components/demo-workspace-mock.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DemoWorkspace } from '../../tutorial/DemoWorkspaceMock'
import { WORKTREE_DRAG_MIME } from '../../lib/dragTypes'

const FEAT = 'C:/demo/.worktrees/nest-web/feat-dark-mode'
const BILLING = 'C:/demo/.worktrees/nest-web/feat-billing'
const ROOT = 'C:/demo/nest-web'

function resolveBranch(p: string): string | undefined {
  return { [FEAT]: 'feat/dark-mode', [BILLING]: 'feat/billing', [ROOT]: 'main' }[p]
}

function dataTransfer(path: string) {
  return { getData: (type: string) => (type === WORKTREE_DRAG_MIME ? path : ''), types: [WORKTREE_DRAG_MIME] }
}

describe('DemoWorkspace (interactive mock)', () => {
  it('seeds two panes', () => {
    render(<DemoWorkspace resolveBranch={resolveBranch} selectedRepoPath={null} />)
    expect(screen.getAllByText(/CLAUDE|CODEX/).length).toBeGreaterThanOrEqual(2)
  })

  it('opening a dropped worktree adds a pane and fires onPaneOpened', () => {
    const onPaneOpened = vi.fn()
    render(<DemoWorkspace resolveBranch={resolveBranch} selectedRepoPath={null} onPaneOpened={onPaneOpened} />)
    const ws = screen.getByTestId('demo-workspace')
    fireEvent.drop(ws, { dataTransfer: dataTransfer(BILLING) })
    expect(onPaneOpened).toHaveBeenCalledTimes(1)
    expect(screen.getByText('feat/billing')).toBeInTheDocument()
  })

  it('shows Sync cwd when the focused pane diverges, then clears it on click', () => {
    const onSyncCwd = vi.fn()
    const { rerender } = render(
      <DemoWorkspace resolveBranch={resolveBranch} selectedRepoPath={null} onSyncCwd={onSyncCwd} />,
    )
    expect(screen.queryByRole('button', { name: /sync cwd/i })).toBeNull()

    rerender(<DemoWorkspace resolveBranch={resolveBranch} selectedRepoPath={ROOT} onSyncCwd={onSyncCwd} />)
    const syncBtn = screen.getByRole('button', { name: /sync cwd/i })
    expect(syncBtn).toHaveAttribute('data-tour-id', 'pane-sync-cwd-btn')

    fireEvent.click(syncBtn)
    expect(onSyncCwd).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /sync cwd/i })).toBeNull()
  })

  it('toggles the drop-target class on drag over / leave', () => {
    render(<DemoWorkspace resolveBranch={resolveBranch} selectedRepoPath={null} />)
    const ws = screen.getByTestId('demo-workspace')
    expect(ws.className).not.toMatch(/grid-workspace--drop-target/)
    fireEvent.dragOver(ws, { dataTransfer: dataTransfer(BILLING) })
    expect(ws.className).toMatch(/grid-workspace--drop-target/)
  })
})
