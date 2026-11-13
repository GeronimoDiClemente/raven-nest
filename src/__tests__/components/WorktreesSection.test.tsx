// The Worktrees section used to have its own expand/collapse toggle on the
// header. Now that Worktrees lives inside its own sidebar tab, that toggle is
// redundant (the tab itself is the show/hide mechanism) — the list must stay
// visible regardless of how many times the header is clicked.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { WorktreesSection } from '../../components/WorktreesSection'

const ROOT = 'C:/real/my-app'

function meta(repoPath: string, branch: string, isRoot: boolean) {
  return {
    repoPath, branch, setupState: 'done', isRoot, rootRepoPath: ROOT,
    declaredPorts: [], detectedPorts: [], createdAt: 0, updatedAt: 0,
  }
}

beforeEach(() => {
  Object.assign(window as unknown as Record<string, unknown>, {
    worktree: { list: vi.fn(async () => ({ ok: true, worktrees: [meta(ROOT, 'main', true)] })), remove: vi.fn(async () => {}) },
    git: { shortstat: vi.fn(async () => ({ additions: 0, deletions: 0, filesChanged: 0 })), findPRForBranch: vi.fn(async () => null), pushBranch: vi.fn(async () => ({ ok: true, branch: '', compareUrl: '' })) },
    spotlight: { status: vi.fn(async () => ({ active: false })), onStatus: vi.fn(), start: vi.fn(async () => {}), stop: vi.fn(async () => {}), removeListeners: vi.fn() },
    preset: { onSetupState: vi.fn(), cancel: vi.fn(async () => {}), removeListeners: vi.fn() },
    electronShell: { openExternal: vi.fn() },
  })
})

describe('WorktreesSection — no collapse toggle', () => {
  it('keeps the worktree list visible after clicking the header', async () => {
    render(
      <WorktreesSection repoPath={ROOT} activeRepoPath={ROOT} onSelect={() => {}} onNewClick={() => {}} onFixCi={() => {}} />,
    )
    await waitFor(() => expect(screen.getByText('main')).toBeInTheDocument())
    fireEvent.click(screen.getByText(/Worktrees/))
    expect(screen.getByText('main')).toBeInTheDocument()
  })
})
