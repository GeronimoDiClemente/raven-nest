// src/__tests__/tutorial/harness.test.ts
import { describe, it, expect } from 'vitest'
import { createDemoHarness } from '../../tutorial/demo/harness'
import { createDemoState } from '../../tutorial/demo/fixtures'
import { bridge } from '../../lib/bridge'

describe('demo harness bridge value', () => {
  it('exposes worktree-domain mocks via harness.bridge', async () => {
    const harness = createDemoHarness(createDemoState())
    const b = harness.bridge as unknown as {
      git: { listBranches: (r: string) => Promise<{ defaultBranch: string }> }
      worktree: { list: (r: string) => Promise<{ ok: boolean }> }
    }
    expect((await b.git.listBranches('x')).defaultBranch).toBe('main')
    expect(await b.worktree.list('x')).toMatchObject({ ok: true })
  })

  it('does NOT touch the global bridge — the live app keeps reading window', async () => {
    const realGit = { listBranches: async () => ({ defaultBranch: 'REAL', branches: [] }) }
    ;(window as unknown as { git: unknown }).git = realGit

    const harness = createDemoHarness(createDemoState())
    harness.activate()

    // `bridge` (what the live app, outside any BridgeProvider, reads) is
    // unaffected by the harness — the mocks live only on harness.bridge.
    const after = await (bridge as unknown as {
      git: { listBranches: (r: string) => Promise<{ defaultBranch: string }> }
    }).git.listBranches('x')
    expect(after.defaultBranch).toBe('REAL')

    harness.deactivate()
  })
})
