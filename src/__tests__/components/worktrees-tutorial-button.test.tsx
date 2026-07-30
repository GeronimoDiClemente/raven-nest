// src/__tests__/components/worktrees-tutorial-button.test.tsx
//
// The Worktrees section header offers a "?" button that launches the worktrees
// tutorial over the live app. It must call onStartTutorial without toggling the
// section's expand/collapse (the header's own onClick).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

describe('Worktrees tutorial launch button', () => {
  it('calls onStartTutorial when the "?" button is clicked', async () => {
    const onStartTutorial = vi.fn()
    render(
      <WorktreesSection
        repoPath={ROOT}
        activeRepoPath={ROOT}
        onSelect={() => {}}
        onNewClick={() => {}}
        onStartTutorial={onStartTutorial}
      />,
    )
    const btn = await waitFor(() => screen.getByTitle('Tutorial: Worktrees'))
    btn.click()
    expect(onStartTutorial).toHaveBeenCalledTimes(1)
  })

  it('does not render the "?" button when onStartTutorial is absent', async () => {
    render(
      <WorktreesSection repoPath={ROOT} activeRepoPath={ROOT} onSelect={() => {}} onNewClick={() => {}} />,
    )
    await waitFor(() => expect(screen.getByText(/Worktrees/)).toBeInTheDocument())
    expect(screen.queryByTitle('Tutorial: Worktrees')).toBeNull()
  })
})
