import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { WorktreeStore } from '../worktree-store'
import { makeTmpDir, cleanupTmp } from './setup'

describe('Worktree integration (happy path)', () => {
  let repoPath: string
  let storeDir: string
  let store: WorktreeStore
  const wtPath: string[] = []

  beforeAll(() => {
    repoPath = makeTmpDir('repo-')
    storeDir = makeTmpDir('store-')
    execSync(`git -C "${repoPath}" init -q`)
    execSync(`git -C "${repoPath}" config user.email t@t.com`)
    execSync(`git -C "${repoPath}" config user.name T`)
    execSync(`git -C "${repoPath}" commit -q --allow-empty -m initial`)
    store = new WorktreeStore(storeDir)
  })

  afterAll(() => {
    cleanupTmp(repoPath)
    cleanupTmp(storeDir)
    for (const w of wtPath) cleanupTmp(w)
  })

  it('hydrate of fresh repo returns single root entry', () => {
    const wts = store.hydrateFromGit(repoPath)
    expect(wts).toHaveLength(1)
    // WorktreeStore normalizes Windows paths to POSIX (see posixKey).
    expect(wts[0].rootRepoPath).toBe(repoPath.replace(/\\/g, '/'))
  })

  it('after git worktree add, hydrate returns 2 entries', () => {
    const wt = `${repoPath}-wt-feat-test`
    wtPath.push(wt)
    execSync(`git -C "${repoPath}" worktree add -b feat/test "${wt}"`)
    const wts = store.hydrateFromGit(repoPath)
    expect(wts).toHaveLength(2)
    const feat = wts.find((w) => w.branch === 'feat/test')
    expect(feat).toBeDefined()
    expect(existsSync(feat!.repoPath)).toBe(true)
  })

  it('reconcile after manual git worktree remove marks orphaned', () => {
    const wt = `${repoPath}-wt-feat-test`
    execSync(`git -C "${repoPath}" worktree remove "${wt}" --force`)
    const fresh = store.hydrateFromGit(repoPath).map((m) => m.repoPath)
    store.reconcile(fresh)
    const orphaned = store.list().find((m) => m.branch === 'feat/test')
    expect(orphaned?.setupState).toBe('orphaned')
  })
})
