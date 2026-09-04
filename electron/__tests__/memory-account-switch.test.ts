// Task 1 (plan de memoria por cuenta multi-dispositivo), Step 3c: swapMemoryStore() tests.
// Uses fakes for daemon/ipcServer (implementing only the Pick<...> methods SwapContext
// needs — see memory-account-switch.ts) and a REAL MemoryStore over a tmp dir, same
// makeTmpDir/cleanupTmp pattern as memory-store.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { swapMemoryStore, type SwapContext } from '../memory-account-switch'
import { MemoryStore, resolveStorePath } from '../memory-store'

function fakeDaemon() {
  return {
    pause: vi.fn(async () => {}),
    resume: vi.fn(() => {}),
    setStore: vi.fn((_store: MemoryStore) => {}),
  }
}

function fakeIpcServer() {
  return {
    suspend: vi.fn(async () => {}),
    resume: vi.fn(() => {}),
    setStore: vi.fn((_store: MemoryStore) => {}),
  }
}

describe('swapMemoryStore (Task 1 Step 3c)', () => {
  let home: string

  beforeEach(() => {
    home = makeTmpDir('raven-swap-')
  })

  afterEach(() => {
    cleanupTmp(home)
  })

  it('swaps _local -> a new account: renames the directory and claims the store', async () => {
    const localPath = resolveStorePath(home, null)
    const store = new MemoryStore(localPath)
    // Something captured before login, to prove the rename actually carried real data.
    store.save({ projectKey: 'proj-a', type: 'discovery', title: 'pre-login note', content: 'x', source: 'mcp' })

    const daemon = fakeDaemon()
    const ipcServer = fakeIpcServer()
    const callOrder: string[] = []
    daemon.resume.mockImplementation(() => { callOrder.push('daemon') })
    ipcServer.resume.mockImplementation(() => { callOrder.push('ipc') })
    const ctx: SwapContext = { store, daemon, ipcServer, currentStorePath: localPath }

    const result = await swapMemoryStore(ctx, home, 'user-123')

    expect(result.error).toBeUndefined()
    const targetPath = resolveStorePath(home, 'user-123')
    expect(result.currentStorePath).toBe(targetPath)
    // The _local directory is gone (renamed away), the account directory now holds the db.
    expect(existsSync(localPath)).toBe(false)
    expect(existsSync(targetPath)).toBe(true)

    // setCurrentUser was called on the new store: it claimed ownership of the pre-login row.
    expect(result.store.getOwnerUserId()).toBe('user-123')
    const items = result.store.search('proj-a', 'pre-login')
    expect(items).toHaveLength(1)

    // Wire-in happened exactly once, and in the documented order (daemon before ipcServer
    // on resume — correction #7).
    expect(daemon.setStore).toHaveBeenCalledTimes(1)
    expect(daemon.setStore).toHaveBeenCalledWith(result.store)
    expect(ipcServer.setStore).toHaveBeenCalledTimes(1)
    expect(ipcServer.setStore).toHaveBeenCalledWith(result.store)
    expect(ipcServer.suspend).toHaveBeenCalledTimes(1)
    expect(daemon.pause).toHaveBeenCalledTimes(1)
    expect(daemon.resume).toHaveBeenCalledTimes(1)
    expect(ipcServer.resume).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['daemon', 'ipc'])

    result.store.close()
  })

  it('is a no-op when targetPath === currentStorePath: no close, no rename, no wire-in', async () => {
    const localPath = resolveStorePath(home, null)
    const store = new MemoryStore(localPath)
    const closeSpy = vi.spyOn(store, 'close')

    const daemon = fakeDaemon()
    const ipcServer = fakeIpcServer()
    const ctx: SwapContext = { store, daemon, ipcServer, currentStorePath: localPath }

    // null userId also resolves to the _local path — same file, so this must be a no-op.
    const result = await swapMemoryStore(ctx, home, null)

    expect(result.error).toBeUndefined()
    expect(result.store).toBe(store)
    expect(result.currentStorePath).toBe(localPath)
    expect(closeSpy).not.toHaveBeenCalled()
    expect(daemon.pause).not.toHaveBeenCalled()
    expect(ipcServer.suspend).not.toHaveBeenCalled()
    expect(daemon.setStore).not.toHaveBeenCalled()
    expect(ipcServer.setStore).not.toHaveBeenCalled()
    expect(daemon.resume).not.toHaveBeenCalled()
    expect(ipcServer.resume).not.toHaveBeenCalled()

    store.close()
  })

  it('THE critical case: when opening the new store throws, daemon/ipcServer still get wired to a valid fallback store — never left pointing at the closed one', async () => {
    // Two already-established real accounts (not _local), so the rename branch never
    // engages — this isolates the failure to exactly the reopen call the adversarial
    // review's hallazgo 1 was about.
    const currentPath = resolveStorePath(home, 'user-current')
    const store = new MemoryStore(currentPath)
    store.save({ projectKey: 'proj-a', type: 'discovery', title: 'still here', content: 'x', source: 'mcp' })

    const daemon = fakeDaemon()
    const ipcServer = fakeIpcServer()
    const ctx: SwapContext = { store, daemon, ipcServer, currentStorePath: currentPath }

    // Force `new MemoryStore(targetPath)` itself to throw: pre-create the target
    // account's .db file with bytes that are not a valid SQLite database. better-sqlite3
    // opens the file lazily, but the constructor's own `PRAGMA journal_mode = WAL` call
    // right after fails immediately against a corrupt file — the throw happens inside
    // `new MemoryStore(targetPath)`, exactly the case the critique flagged as broken.
    const userId = 'user-broken'
    const targetPath = resolveStorePath(home, userId)
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, 'not a valid sqlite database file')

    const result = await swapMemoryStore(ctx, home, userId)

    // Never throws (this line is only reached if it didn't), and never leaves
    // daemon/ipcServer wired to `undefined` or skipped entirely.
    expect(result.store).toBeDefined()
    expect(result.error).toBeTruthy()

    expect(daemon.setStore).toHaveBeenCalledTimes(1)
    expect(ipcServer.setStore).toHaveBeenCalledTimes(1)
    const wiredStore = daemon.setStore.mock.calls[0][0] as MemoryStore
    expect(ipcServer.setStore.mock.calls[0][0]).toBe(wiredStore)
    expect(wiredStore).toBe(result.store)

    // Fallback reopened the ORIGINAL store (untouched — no rename between two real
    // accounts), and it is still fully functional, not the closed original object.
    expect(result.currentStorePath).toBe(currentPath)
    const items = wiredStore.search('proj-a', 'still here')
    expect(items).toHaveLength(1)

    // Resume/wire-in still ran despite the failure — the daemon/ipc are not stuck
    // suspended forever just because the swap itself failed.
    expect(daemon.resume).toHaveBeenCalledTimes(1)
    expect(ipcServer.resume).toHaveBeenCalledTimes(1)

    wiredStore.close()
  })

  it('returns error set (not thrown) while memory keeps working via the fallback store', async () => {
    const currentPath = resolveStorePath(home, 'user-current-2')
    const store = new MemoryStore(currentPath)
    const daemon = fakeDaemon()
    const ipcServer = fakeIpcServer()
    const ctx: SwapContext = { store, daemon, ipcServer, currentStorePath: currentPath }

    const userId = 'user-broken-2'
    const targetPath = resolveStorePath(home, userId)
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, 'not a valid sqlite database file')

    let thrown: unknown = null
    let result
    try {
      result = await swapMemoryStore(ctx, home, userId)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeNull()
    expect(result).toBeDefined()
    expect(result!.error).toBeTruthy()
    // The app still has a working store: a fresh save/search round-trips through it.
    const saveResult = result!.store.save({ projectKey: 'p', type: 'discovery', title: 'after-fallback', content: 'y', source: 'mcp' })
    expect(saveResult.outcome).toBe('inserted')
    expect(result!.store.search('p', 'after-fallback')).toHaveLength(1)

    result!.store.close()
  })

  it('BUG 1 (Windows EPERM): skips the directory rename when the target directory already exists, even empty — degrades to a fresh store instead of breaking the swap', async () => {
    const localPath = resolveStorePath(home, null)
    const store = new MemoryStore(localPath)
    store.save({ projectKey: 'proj-a', type: 'discovery', title: 'pre-login note', content: 'x', source: 'mcp' })

    const daemon = fakeDaemon()
    const ipcServer = fakeIpcServer()
    const ctx: SwapContext = { store, daemon, ipcServer, currentStorePath: localPath }

    // Simulate a leftover empty target directory — provisioning residue, a folder created
    // by hand, external sync, whatever — with no memory.db inside it yet. On Windows,
    // renaming a directory ONTO this would fail EVERY time with EPERM (not the transient
    // antivirus/OneDrive EPERM renameDirWithRetry is built to ride out), so the fix must
    // never attempt the rename in the first place when this directory is already there.
    const userId = 'user-existing-empty-dir'
    const targetPath = resolveStorePath(home, userId)
    const targetDir = dirname(targetPath)
    mkdirSync(targetDir, { recursive: true })
    expect(existsSync(targetDir)).toBe(true)
    expect(existsSync(targetPath)).toBe(false) // the container exists, but no .db inside yet

    const result = await swapMemoryStore(ctx, home, userId)

    expect(result.error).toBeUndefined()
    // The rename was never attempted: _local's directory (and its data) is still on disk,
    // untouched. If the rename had been attempted and had "succeeded" by clobbering the
    // empty dir (POSIX behavior) this would be false; if it had been attempted and thrown
    // (real Windows behavior), we'd be in the fallback branch with `result.error` set —
    // neither happened.
    expect(existsSync(localPath)).toBe(true)

    // The new account got a fresh, working store at targetPath instead — degrading
    // gracefully (an empty base) rather than failing the whole swap.
    expect(existsSync(targetPath)).toBe(true)
    expect(result.currentStorePath).toBe(targetPath)
    expect(result.store.getOwnerUserId()).toBe(userId)
    // Fresh base: the pre-login note was never moved into it (nothing was renamed).
    expect(result.store.search('proj-a', 'pre-login')).toHaveLength(0)

    expect(daemon.setStore).toHaveBeenCalledTimes(1)
    expect(daemon.setStore).toHaveBeenCalledWith(result.store)
    expect(ipcServer.setStore).toHaveBeenCalledTimes(1)
    expect(daemon.resume).toHaveBeenCalledTimes(1)
    expect(ipcServer.resume).toHaveBeenCalledTimes(1)

    result.store.close()
  })

  it('BUG 2: when a rename already happened and BOTH fallback reopens then fail, currentStorePath is the renamed target, not the vanished original', async () => {
    const localPath = resolveStorePath(home, null)
    const store = new MemoryStore(localPath)
    store.save({ projectKey: 'proj-a', type: 'discovery', title: 'pre-login note', content: 'x', source: 'mcp' })
    // Close it and corrupt the bytes on disk directly — after the directory gets renamed
    // below, this corrupt file is what every reopen attempt (primary + both fallbacks) will
    // find at the NEW location, forcing the exact "renamed=true, both fallbacks fail" branch
    // BUG 2 was about, without needing to mock MemoryStore itself.
    store.close()
    writeFileSync(localPath, 'not a valid sqlite database file')

    const daemon = fakeDaemon()
    const ipcServer = fakeIpcServer()
    const ctx: SwapContext = { store, daemon, ipcServer, currentStorePath: localPath }

    const userId = 'user-double-fallback'
    const targetPath = resolveStorePath(home, userId)

    const result = await swapMemoryStore(ctx, home, userId)

    // Never throws, and the swap did report a problem (both reopen attempts failed).
    expect(result.error).toBeTruthy()

    // The rename DID happen (_local's directory is gone, its content now lives at
    // targetPath, still corrupt) — this is the precondition BUG 2 needed: `renamed = true`.
    expect(existsSync(localPath)).toBe(false)
    expect(existsSync(targetPath)).toBe(true)

    // THE fix: currentStorePath must be targetPath (where the real, if corrupt, bytes now
    // are), never the original ctx.currentStorePath (localPath) — that directory no longer
    // exists on disk at all, so reporting it would point the caller at a dead path.
    expect(result.currentStorePath).toBe(targetPath)
    expect(result.currentStorePath).not.toBe(localPath)

    // Wire-in still happened exactly once, unconditionally, with the degraded (closed)
    // store object — never left pointing at undefined.
    expect(daemon.setStore).toHaveBeenCalledTimes(1)
    expect(ipcServer.setStore).toHaveBeenCalledTimes(1)
    expect(daemon.resume).toHaveBeenCalledTimes(1)
    expect(ipcServer.resume).toHaveBeenCalledTimes(1)
  })

  it('BUG 3: logs the adoption message when setCurrentUser claims the store, stays silent when it does not', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      // Case 1: _local -> a brand-new account. Nobody owns this store yet, so
      // setCurrentUser claims it and adopts the pre-login row — the log line must appear.
      const localPath = resolveStorePath(home, null)
      const store1 = new MemoryStore(localPath)
      store1.save({ projectKey: 'proj-a', type: 'discovery', title: 'pre-login note', content: 'x', source: 'mcp' })

      const daemon1 = fakeDaemon()
      const ipcServer1 = fakeIpcServer()
      const ctx1: SwapContext = { store: store1, daemon: daemon1, ipcServer: ipcServer1, currentStorePath: localPath }

      const firstUserId = 'user-claims-it'
      const result1 = await swapMemoryStore(ctx1, home, firstUserId)
      expect(result1.error).toBeUndefined()
      expect(result1.store.getOwnerUserId()).toBe(firstUserId)

      const claimCalls = logSpy.mock.calls.filter((args) =>
        typeof args[0] === 'string' && args[0].includes('reclamado')
      )
      expect(claimCalls).toHaveLength(1)
      expect(claimCalls[0]).toContain(firstUserId)
      // The adopted count comes straight from setCurrentUser's own return value — just
      // confirm it's a positive number (observations + mutation_log rows adopted), not that
      // it's logged at all rather than checking an exact count this test doesn't control.
      const loggedAdoptedCount = claimCalls[0][claimCalls[0].length - 1]
      expect(loggedAdoptedCount).toBeGreaterThan(0)

      result1.store.close()
      logSpy.mockClear()

      // Case 2: an account already owns the target store (pre-established below) — a
      // second entry must NOT reclaim it, so no adoption log this time.
      const secondUserId = 'user-already-owns-it'
      const preOwnedPath = resolveStorePath(home, secondUserId)
      const preOwnedStore = new MemoryStore(preOwnedPath)
      preOwnedStore.setCurrentUser(secondUserId)
      preOwnedStore.close()

      const otherCurrentPath = resolveStorePath(home, 'user-somewhere-else')
      const store2 = new MemoryStore(otherCurrentPath)
      const daemon2 = fakeDaemon()
      const ipcServer2 = fakeIpcServer()
      const ctx2: SwapContext = { store: store2, daemon: daemon2, ipcServer: ipcServer2, currentStorePath: otherCurrentPath }

      const result2 = await swapMemoryStore(ctx2, home, secondUserId)
      expect(result2.error).toBeUndefined()

      const claimCalls2 = logSpy.mock.calls.filter((args) =>
        typeof args[0] === 'string' && args[0].includes('reclamado')
      )
      expect(claimCalls2).toHaveLength(0)

      result2.store.close()
    } finally {
      logSpy.mockRestore()
    }
  })
})
