import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeTmpDir, cleanupTmp } from './setup'

describe('SettingsStore — hasSeenMemoryHub', () => {
  let home: string
  let storeModule: typeof import('../settings-store')

  beforeEach(async () => {
    home = makeTmpDir('raven-settings-')
    process.env.RAVEN_HOME = home
    vi.resetModules()
    storeModule = await import('../settings-store')
  })

  afterEach(() => {
    delete process.env.RAVEN_HOME
    cleanupTmp(home)
  })

  it('defaults to false when no settings file exists yet', () => {
    const store = new storeModule.SettingsStore()
    expect(store.get().hasSeenMemoryHub).toBe(false)
  })

  it('persists across a set/get round-trip', () => {
    const store = new storeModule.SettingsStore()
    store.set({ ...store.get(), hasSeenMemoryHub: true })
    expect(store.get().hasSeenMemoryHub).toBe(true)
  })
})
