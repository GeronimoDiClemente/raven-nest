// src/__tests__/components/worktrees-tutorial.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TutorialSandbox } from '../../tutorial/TutorialSandbox'

describe('worktrees tutorial (demo sandbox)', () => {
  beforeEach(() => {
    // Sentinels: the REAL window.* must never be called (components read via bridge,
    // which the demo harness overrides). If a component still touches window.worktree
    // or window.diff directly, these throw and the test fails loudly.
    ;(window as unknown as { worktree: unknown }).worktree = {
      list: vi.fn(() => {
        throw new Error('real worktree called')
      }),
    }
    ;(window as unknown as { diff: unknown }).diff = {
      get: vi.fn(() => {
        throw new Error('real diff called')
      }),
    }
    // Minimal real-window stubs that the preload provides in production but jsdom
    // lacks. WorktreesSection's effect *cleanups* (removeListeners) run AFTER the
    // sandbox's harness.deactivate() has restored bridge → window delegation, so on
    // unmount they hit window.spotlight / window.preset. In the real app these
    // exist; stub them here so teardown doesn't throw on undefined. These are NOT
    // the guarded APIs (worktree.list / diff.get) — they're never reached during
    // the active tour, only at unmount, so the no-real-API guard is unaffected.
    ;(window as unknown as { spotlight: unknown }).spotlight = { removeListeners: vi.fn() }
    ;(window as unknown as { preset: unknown }).preset = { removeListeners: vi.fn() }
  })

  it('mounts the real WorktreesSection with demo data and shows step 1', async () => {
    render(<TutorialSandbox tourId="worktrees" onClose={() => {}} />)
    // The sandbox renders nothing until the harness activates (useEffect → ready).
    await waitFor(() =>
      expect(screen.getByText(/Un worktree es una rama/)).toBeInTheDocument(),
    )
    // Step 1 title is exactly "Worktrees" (the section header DOM text is
    // "▾ Worktrees" with the chevron, so it won't collide with an exact match).
    expect(screen.getByText('Worktrees')).toBeInTheDocument()
    // Progress badge: step 1 of 11.
    expect(screen.getByText(/1\s*\/\s*11/)).toBeInTheDocument()

    // Regression guard: the diff/pr chip tour anchors must resolve in the DOM on
    // initial mount. They render only on NON-root worktrees, and the chip data
    // (diff stats, PR lookup) loads via async effects, so wait for them. If these
    // anchors land on index 0 (root, which renders no chips) they resolve to
    // nothing and tour steps 8 (diff) / 10 (pr) show a spotlight-less tooltip.
    await waitFor(() => {
      expect(document.querySelector('[data-tour-id="wt-diff-chip"]')).not.toBeNull()
    })
    await waitFor(() => {
      expect(document.querySelector('[data-tour-id="wt-pr-chip"]')).not.toBeNull()
    })
  })

  it('walks the whole tour via Next and finishes', async () => {
    const onClose = vi.fn()
    render(<TutorialSandbox tourId="worktrees" onClose={onClose} />)
    await waitFor(() =>
      expect(screen.getByText(/Un worktree es una rama/)).toBeInTheDocument(),
    )
    // 11 steps: advance with "Siguiente →" 10 times, then the last step's
    // same button reads "Listo" and finishing calls onClose.
    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByRole('button', { name: /siguiente/i }))
    }
    fireEvent.click(screen.getByRole('button', { name: /listo/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
