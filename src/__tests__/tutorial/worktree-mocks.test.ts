// src/__tests__/tutorial/worktree-mocks.test.ts
import { describe, it, expect, vi } from 'vitest'
import { makeWorktreeMocks } from '../../tutorial/demo/mocks'
import { createDemoState } from '../../tutorial/demo/fixtures'

describe('worktree demo mocks', () => {
  it('list returns the demo worktrees', async () => {
    const state = createDemoState()
    const m = makeWorktreeMocks(state)
    const res = await m.worktree.list(state.worktree.rootRepoPath)
    expect(res).toMatchObject({ ok: true })
    expect((res as { worktrees: unknown[] }).worktrees.length).toBe(2)
  })

  it('create adds a worktree and transitions running -> done', async () => {
    vi.useFakeTimers()
    const state = createDemoState()
    const m = makeWorktreeMocks(state)
    const meta = await m.worktree.create({ repoPath: state.worktree.rootRepoPath, branch: 'feat/new' })
    expect(meta.branch).toBe('feat/new')
    expect(state.worktree.worktrees.some(w => w.branch === 'feat/new')).toBe(true)
    await vi.advanceTimersByTimeAsync(1500)
    expect(state.worktree.worktrees.find(w => w.branch === 'feat/new')?.setupState).toBe('done')
    vi.useRealTimers()
  })

  it('remove deletes the worktree from the store', async () => {
    const state = createDemoState()
    const m = makeWorktreeMocks(state)
    const target = state.worktree.worktrees[1].repoPath
    await m.worktree.remove(target)
    expect(state.worktree.worktrees.some(w => w.repoPath === target)).toBe(false)
  })

  it('diff.get returns the demo diff for a worktree', async () => {
    const state = createDemoState()
    const m = makeWorktreeMocks(state)
    const featPath = state.worktree.worktrees[1].repoPath
    const d = await m.diff.get(featPath)
    expect(d.files[0].path).toBe('src/theme.ts')
  })
})
