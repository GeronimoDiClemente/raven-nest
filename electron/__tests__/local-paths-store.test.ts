import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'

describe('LocalPathsStore', () => {
  let home: string
  let storeModule: typeof import('../local-paths-store')

  beforeEach(async () => {
    home = makeTmpDir('raven-local-paths-')
    process.env.RAVEN_HOME = home
    vi.resetModules()
    storeModule = await import('../local-paths-store')
  })

  afterEach(() => {
    delete process.env.RAVEN_HOME
    cleanupTmp(home)
  })

  it('getLocalPath returns null for unknown repo', () => {
    const store = new storeModule.LocalPathsStore()
    expect(store.getLocalPath('does-not-exist')).toBeNull()
  })

  it('setLocalPath + getLocalPath round-trip', () => {
    const store = new storeModule.LocalPathsStore()
    store.setLocalPath('repo-1', 'C:/dev/repo-1')
    expect(store.getLocalPath('repo-1')).toBe('C:/dev/repo-1')
  })

  it('deleteLocalPath removes the entry', () => {
    const store = new storeModule.LocalPathsStore()
    store.setLocalPath('repo-1', '/x')
    store.deleteLocalPath('repo-1')
    expect(store.getLocalPath('repo-1')).toBeNull()
  })

  it('getAllLocalPaths returns the full map', () => {
    const store = new storeModule.LocalPathsStore()
    store.setLocalPath('a', '/a')
    store.setLocalPath('b', '/b')
    expect(store.getAllLocalPaths()).toEqual({ a: '/a', b: '/b' })
  })

  it('persists across instances (re-instantiation)', () => {
    new storeModule.LocalPathsStore().setLocalPath('persist', '/p')
    expect(new storeModule.LocalPathsStore().getLocalPath('persist')).toBe('/p')
  })

  it('getMigrationFlag returns null when unset', () => {
    const store = new storeModule.LocalPathsStore()
    expect(store.getMigrationFlag('paths-v1:user-x')).toBeNull()
  })

  it('setMigrationFlag + getMigrationFlag round-trip', () => {
    const store = new storeModule.LocalPathsStore()
    store.setMigrationFlag('paths-v1:user-x', 'done')
    expect(store.getMigrationFlag('paths-v1:user-x')).toBe('done')
  })

  it('flags survive across instances', () => {
    new storeModule.LocalPathsStore().setMigrationFlag('paths-v1:u', 'done')
    expect(new storeModule.LocalPathsStore().getMigrationFlag('paths-v1:u')).toBe('done')
  })

  it('handles corrupted JSON by renaming and starting fresh', () => {
    const dir = join(home, '.raven-nest')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'local-paths.json'), '{not json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = new storeModule.LocalPathsStore()
    expect(store.getAllLocalPaths()).toEqual({})
    const siblings = readdirSync(dir)
    expect(siblings.some((f) => f.startsWith('local-paths.') && f.endsWith('.corrupt.bak'))).toBe(true)
    warn.mockRestore()
  })
})
