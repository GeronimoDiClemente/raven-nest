import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'

describe('AccountStore', () => {
  let home: string
  let storeModule: typeof import('../account-store')

  beforeEach(async () => {
    home = makeTmpDir('raven-accounts-')
    process.env.RAVEN_HOME = home
    vi.resetModules()
    storeModule = await import('../account-store')
  })

  afterEach(() => {
    delete process.env.RAVEN_HOME
    cleanupTmp(home)
  })

  it('save + list + delete round-trip', () => {
    const store = new storeModule.AccountStore()
    store.save('terminal', 'work')
    store.save('terminal', 'personal')
    expect(store.list('terminal').sort()).toEqual(['personal', 'work'])
    store.delete('terminal', 'work')
    expect(store.list('terminal')).toEqual(['personal'])
  })

  it('rejects account names with path traversal', () => {
    const store = new storeModule.AccountStore()
    expect(() => store.getDir('terminal', '../otro')).toThrow(/Invalid account name/)
    expect(() => store.getDir('terminal', 'a/b')).toThrow(/Invalid account name/)
    expect(() => store.getDir('terminal', 'a\\b')).toThrow(/Invalid account name/)
  })

  it('delete with empty name throws instead of wiping every account of the aiType', () => {
    const store = new storeModule.AccountStore()
    store.save('terminal', 'work')
    store.save('terminal', 'personal')

    expect(() => store.delete('terminal', '')).toThrow(/Invalid account name/)

    // Both accounts must survive — '' used to resolve to the aiType root dir.
    expect(store.list('terminal').sort()).toEqual(['personal', 'work'])
  })

  it('delete with "." or whitespace-only name throws', () => {
    const store = new storeModule.AccountStore()
    store.save('terminal', 'work')

    expect(() => store.delete('terminal', '.')).toThrow(/Invalid account name/)
    expect(() => store.delete('terminal', '   ')).toThrow(/Invalid account name/)

    expect(store.list('terminal')).toEqual(['work'])
    expect(existsSync(join(home, '.raven-nest', 'accounts', 'terminal', 'work'))).toBe(true)
  })
})
