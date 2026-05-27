// src/__tests__/tutorial/harness.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createDemoHarness } from '../../tutorial/demo/harness'
import { createDemoState } from '../../tutorial/demo/fixtures'

describe('demo harness window swap', () => {
  beforeEach(() => {
    // Sentinel "real" APIs so we can prove they are restored and never called.
    ;(window as unknown as { git: unknown }).git = { __real: true }
    ;(window as unknown as { worktree: unknown }).worktree = { __real: true }
  })

  it('replaces window.git while active and restores it after', async () => {
    const harness = createDemoHarness(createDemoState())
    harness.activate()
    // Mock returns fixture-shaped data, not the sentinel.
    const branches = await window.git.listBranches('x')
    expect(branches.defaultBranch).toBe('main')
    expect((window as unknown as { git: { __real?: boolean } }).git.__real).toBeUndefined()

    harness.deactivate()
    expect((window as unknown as { git: { __real?: boolean } }).git.__real).toBe(true)
  })

  it('swaps and restores window.worktree (mock built via a separate path)', async () => {
    const harness = createDemoHarness(createDemoState())
    harness.activate()
    // Mock returns fixture-shaped data, not the sentinel.
    const list = await window.worktree.list('x')
    expect(list).toMatchObject({ ok: true })
    expect((window as unknown as { worktree: { __real?: boolean } }).worktree.__real).toBeUndefined()

    harness.deactivate()
    expect((window as unknown as { worktree: { __real?: boolean } }).worktree.__real).toBe(true)
  })
})
