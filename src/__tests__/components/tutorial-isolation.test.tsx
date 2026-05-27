// src/__tests__/components/tutorial-isolation.test.tsx
//
// Regression for the bug where opening the tutorial over a LIVE app (a repo
// linked, so the real WorktreesSection is mounted) polluted the real sidebar
// with demo data and made the coachmark target the wrong (background) anchor.
// The fix: bridge is scoped per React subtree (BridgeProvider/useBridge) and
// the tour scopes anchor lookups to the sandbox container.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { WorktreesSection } from '../../components/WorktreesSection'
import { TutorialSandbox } from '../../tutorial/TutorialSandbox'

const REAL_ROOT = 'C:/real/my-app'
const REAL_WT = 'C:/real/.worktrees/my-app/real-feature'

function meta(repoPath: string, branch: string, isRoot: boolean) {
  return {
    repoPath,
    branch,
    setupState: 'done',
    isRoot,
    rootRepoPath: REAL_ROOT,
    declaredPorts: [],
    detectedPorts: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

beforeEach(() => {
  // The REAL app's window.* — returns REAL worktrees. The sandbox must NOT see these.
  Object.assign(window as unknown as Record<string, unknown>, {
    worktree: {
      list: vi.fn(async () => ({
        ok: true,
        worktrees: [meta(REAL_ROOT, 'main', true), meta(REAL_WT, 'real-feature', false)],
      })),
      remove: vi.fn(async () => {}),
    },
    git: {
      shortstat: vi.fn(async () => ({ additions: 3, deletions: 0, filesChanged: 1 })),
      findPRForBranch: vi.fn(async () => null),
      pushBranch: vi.fn(async () => ({ ok: true, branch: 'real-feature', compareUrl: '' })),
    },
    spotlight: {
      status: vi.fn(async () => ({ active: false })),
      onStatus: vi.fn(),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      removeListeners: vi.fn(),
    },
    preset: { onSetupState: vi.fn(), cancel: vi.fn(async () => {}), removeListeners: vi.fn() },
    electronShell: { openExternal: vi.fn() },
  })
})

describe('tutorial isolation from the live app', () => {
  it('real WorktreesSection keeps real data while the sandbox shows demo data', async () => {
    render(
      <div>
        <div data-testid="live-app">
          {/* The live app, OUTSIDE any BridgeProvider → reads window (real data). */}
          <WorktreesSection
            repoPath={REAL_ROOT}
            activeRepoPath={REAL_ROOT}
            onSelect={() => {}}
            onNewClick={() => {}}
          />
        </div>
        <TutorialSandbox tourId="worktrees" onClose={() => {}} />
      </div>,
    )

    // Live app shows the REAL branch, never the demo one.
    const live = within(screen.getByTestId('live-app'))
    await waitFor(() => expect(live.getByText('real-feature', { selector: '.wt-branch' })).toBeInTheDocument())
    expect(live.queryByText('feat/dark-mode', { selector: '.wt-branch' })).toBeNull()

    // The sandbox shows the DEMO branch (its components read mocks via the provider).
    const sandbox = within(document.querySelector('.tutorial-sandbox') as HTMLElement)
    await waitFor(() => expect(sandbox.getByText('feat/dark-mode', { selector: '.wt-branch' })).toBeInTheDocument())
    expect(sandbox.queryByText('real-feature', { selector: '.wt-branch' })).toBeNull()

    // Both rendered the same data-tour-id (duplicate anchors exist), but the
    // window stub for the REAL section never threw → no cross-contamination.
    expect(document.querySelectorAll('[data-tour-id="wt-header"]').length).toBe(2)
  })
})
