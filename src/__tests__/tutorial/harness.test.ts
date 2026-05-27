// src/__tests__/tutorial/harness.test.ts
import { describe, it, expect } from 'vitest'
import { createDemoHarness } from '../../tutorial/demo/harness'
import { createDemoState } from '../../tutorial/demo/fixtures'
import { bridge } from '../../lib/bridge'

describe('demo harness bridge overrides', () => {
  it('routes bridge.git/worktree to mocks while active, restores after', async () => {
    const realGit = { listBranches: async () => ({ defaultBranch: 'REAL', branches: [] }) }
    ;(window as unknown as { git: unknown }).git = realGit

    const harness = createDemoHarness(createDemoState())
    harness.activate()
    const branches = await (bridge as unknown as { git: { listBranches: (r: string) => Promise<{ defaultBranch: string }> } }).git.listBranches('x')
    expect(branches.defaultBranch).toBe('main') // the mock, not 'REAL'
    const list = await (bridge as unknown as { worktree: { list: (r: string) => Promise<{ ok: boolean }> } }).worktree.list('x')
    expect(list).toMatchObject({ ok: true })

    harness.deactivate()
    // bridge now delegates to the real window.git again
    const after = await (bridge as unknown as { git: { listBranches: (r: string) => Promise<{ defaultBranch: string }> } }).git.listBranches('x')
    expect(after.defaultBranch).toBe('REAL')
  })
})
