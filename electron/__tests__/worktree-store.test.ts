import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorktreeStore } from '../worktree-store'
import { makeTmpDir, cleanupTmp } from './setup'
import type { WorktreeMeta } from '../../src/types'

describe('WorktreeStore', () => {
  let storeDir: string
  let store: WorktreeStore

  beforeEach(() => {
    storeDir = makeTmpDir('worktree-store-')
    store = new WorktreeStore(storeDir)
  })

  afterEach(() => {
    cleanupTmp(storeDir)
  })

  it('returns null for an unregistered path', () => {
    expect(store.get('/some/nonexistent/path')).toBeNull()
  })

  it('persists and retrieves WorktreeMeta', () => {
    const meta: WorktreeMeta = {
      repoPath: '/tmp/repo/.git/worktrees/feat-x',
      rootRepoPath: '/tmp/repo',
      branch: 'feat/x',
      setupState: 'idle',
      declaredPorts: [],
      detectedPorts: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    store.setMeta(meta)
    const got = store.get('/tmp/repo/.git/worktrees/feat-x')
    expect(got).toEqual(meta)
  })

  it('persists across instances (reload from disk)', () => {
    const meta: WorktreeMeta = {
      repoPath: '/tmp/repo/.git/worktrees/feat-y',
      rootRepoPath: '/tmp/repo',
      branch: 'feat/y',
      setupState: 'idle',
      declaredPorts: [],
      detectedPorts: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    store.setMeta(meta)
    const reloaded = new WorktreeStore(storeDir)
    expect(reloaded.get('/tmp/repo/.git/worktrees/feat-y')).toEqual(meta)
  })
})
