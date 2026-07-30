import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorktreeStore } from '../worktree-store'
import { makeTmpDir, cleanupTmp } from './setup'
import type { WorktreeMeta } from '../../src/types'
import { execSync } from 'child_process'

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
      createdAt: 1,
      updatedAt: 1,
    }
    const before = Date.now()
    store.setMeta(meta)
    const got = store.get('/tmp/repo/.git/worktrees/feat-x')
    expect(got).not.toBeNull()
    expect(got!.repoPath).toBe(meta.repoPath)
    expect(got!.branch).toBe(meta.branch)
    expect(got!.createdAt).toBe(1)
    expect(got!.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('persists across instances (reload from disk)', () => {
    const meta: WorktreeMeta = {
      repoPath: '/tmp/repo/.git/worktrees/feat-y',
      rootRepoPath: '/tmp/repo',
      branch: 'feat/y',
      setupState: 'idle',
      declaredPorts: [],
      detectedPorts: [],
      createdAt: 1,
      updatedAt: 1,
    }
    store.setMeta(meta)
    const reloaded = new WorktreeStore(storeDir)
    const got = reloaded.get('/tmp/repo/.git/worktrees/feat-y')
    expect(got).not.toBeNull()
    expect(got!.branch).toBe('feat/y')
    expect(got!.createdAt).toBe(1)
  })

  it('removes a meta', () => {
    const meta: WorktreeMeta = {
      repoPath: '/tmp/r/.git/worktrees/x',
      rootRepoPath: '/tmp/r',
      branch: 'x',
      setupState: 'idle',
      declaredPorts: [],
      detectedPorts: [],
      createdAt: 1, updatedAt: 1,
    }
    store.setMeta(meta)
    store.remove('/tmp/r/.git/worktrees/x')
    expect(store.get('/tmp/r/.git/worktrees/x')).toBeNull()
  })

  it('lists all metas', () => {
    store.setMeta({ repoPath: '/a', rootRepoPath: '/r', branch: 'a', setupState: 'idle', declaredPorts: [], detectedPorts: [], createdAt: 1, updatedAt: 1 })
    store.setMeta({ repoPath: '/b', rootRepoPath: '/r', branch: 'b', setupState: 'idle', declaredPorts: [], detectedPorts: [], createdAt: 2, updatedAt: 2 })
    expect(store.list()).toHaveLength(2)
  })

  it('hydrates from git worktree list', () => {
    const repoPath = makeTmpDir('git-repo-')
    execSync(`git -C "${repoPath}" init -q`)
    execSync(`git -C "${repoPath}" config user.email test@example.com`)
    execSync(`git -C "${repoPath}" config user.name Test`)
    execSync(`git -C "${repoPath}" commit -q --allow-empty -m initial`)
    execSync(`git -C "${repoPath}" branch feat/test`)
    const wtPath = `${repoPath}-wt-feat-test`
    execSync(`git -C "${repoPath}" worktree add "${wtPath}" feat/test`)

    const got = store.hydrateFromGit(repoPath)
    expect(got.length).toBeGreaterThanOrEqual(1)
    const featWt = got.find((m) => m.branch === 'feat/test')
    expect(featWt).toBeDefined()
    // WorktreeStore normalizes Windows paths to POSIX (see posixKey),
    // so compare against the forward-slash form of the temp dir.
    expect(featWt!.rootRepoPath).toBe(repoPath.replace(/\\/g, '/'))

    cleanupTmp(repoPath)
    cleanupTmp(wtPath)
  })

  it('marks orphaned metas (path no longer in git list)', () => {
    // Set a meta for a path that does not exist on disk
    store.setMeta({
      repoPath: '/tmp/nonexistent-wt',
      rootRepoPath: '/tmp/r',
      branch: 'gone',
      setupState: 'done',
      declaredPorts: [],
      detectedPorts: [],
      createdAt: 1, updatedAt: 1,
    })
    // Reconcile against an empty git list (mock: empty array returned)
    store.reconcile([])
    expect(store.get('/tmp/nonexistent-wt')?.setupState).toBe('orphaned')
  })

  it('pruneMissing removes entries whose directory no longer exists', () => {
    const liveDir = makeTmpDir('live-wt-')
    store.setMeta({
      repoPath: liveDir,
      rootRepoPath: liveDir,
      branch: 'main',
      setupState: 'idle',
      declaredPorts: [], detectedPorts: [],
      createdAt: 1, updatedAt: 1,
    })
    store.setMeta({
      repoPath: '/tmp/gone-worktree-xyz',
      rootRepoPath: liveDir,
      branch: 'feat/gone',
      setupState: 'orphaned',
      declaredPorts: [], detectedPorts: [],
      createdAt: 1, updatedAt: 1,
    })

    const removed = store.pruneMissing()

    expect(removed).toEqual(['/tmp/gone-worktree-xyz'])
    expect(store.get('/tmp/gone-worktree-xyz')).toBeNull()
    expect(store.get(liveDir)).not.toBeNull()

    cleanupTmp(liveDir)
  })

  it('pruneMissing persists the removal across instances', () => {
    store.setMeta({
      repoPath: '/tmp/gone-worktree-abc',
      rootRepoPath: '/tmp/r',
      branch: 'feat/gone',
      setupState: 'orphaned',
      declaredPorts: [], detectedPorts: [],
      createdAt: 1, updatedAt: 1,
    })
    store.pruneMissing()
    const reloaded = new WorktreeStore(storeDir)
    expect(reloaded.get('/tmp/gone-worktree-abc')).toBeNull()
  })

  it('hydrateFromGit clears a stale orphaned flag when git reports the worktree live', () => {
    const repoPath = makeTmpDir('git-orphan-')
    execSync(`git -C "${repoPath}" init -q`)
    execSync(`git -C "${repoPath}" config user.email test@example.com`)
    execSync(`git -C "${repoPath}" config user.name Test`)
    execSync(`git -C "${repoPath}" commit -q --allow-empty -m initial`)

    // First hydrate registers the root entry as idle...
    store.hydrateFromGit(repoPath)
    const key = repoPath.replace(/\\/g, '/')
    // ...then a prior reconcile (triggered while another repo was active)
    // wrongly left it orphaned.
    const meta = store.get(key)!
    store.setMeta({ ...meta, setupState: 'orphaned' })
    expect(store.get(key)!.setupState).toBe('orphaned')

    // git still lists this worktree, so re-hydrate must clear the stale flag.
    store.hydrateFromGit(repoPath)
    expect(store.get(key)!.setupState).toBe('idle')

    cleanupTmp(repoPath)
  })

  it('hydrateFromGit preserves a real setup state (does not reset done to idle)', () => {
    const repoPath = makeTmpDir('git-done-')
    execSync(`git -C "${repoPath}" init -q`)
    execSync(`git -C "${repoPath}" config user.email test@example.com`)
    execSync(`git -C "${repoPath}" config user.name Test`)
    execSync(`git -C "${repoPath}" commit -q --allow-empty -m initial`)

    store.hydrateFromGit(repoPath)
    const key = repoPath.replace(/\\/g, '/')
    const meta = store.get(key)!
    store.setMeta({ ...meta, setupState: 'done' })

    store.hydrateFromGit(repoPath)
    expect(store.get(key)!.setupState).toBe('done')

    cleanupTmp(repoPath)
  })
})
