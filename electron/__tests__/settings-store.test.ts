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

describe('SettingsStore — hasSeenMemoriesWelcome', () => {
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
    expect(store.get().hasSeenMemoriesWelcome).toBe(false)
  })

  it('persists across a set/get round-trip', () => {
    const store = new storeModule.SettingsStore()
    store.set({ ...store.get(), hasSeenMemoriesWelcome: true })
    expect(store.get().hasSeenMemoriesWelcome).toBe(true)
  })
})

// Final review C1: load() armaba el objeto campo por campo y tiraba memoryPrefs, así que las
// preferencias de Memories no sobrevivían al reinicio y cualquier otro set las reseteaba.
describe('SettingsStore — memoryPrefs', () => {
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

  const prefs = {
    editor: { livePreview: false, readableWidth: false, spellcheck: true, fontSize: 16 },
    graph: { remember: true, labels: 'always', animate: false, filtros: { colorBy: 'tag', hideOrphans: false } },
  }

  it('no hay memoryPrefs hasta que alguien las guarda', () => {
    const store = new storeModule.SettingsStore()
    expect(store.get().memoryPrefs).toBeUndefined()
  })

  it('sobrevive a un set/get (y a un store nuevo, como un reinicio)', () => {
    const store = new storeModule.SettingsStore()
    store.set({ ...storeModule.DEFAULT_SETTINGS, memoryPrefs: prefs })
    expect(store.get().memoryPrefs).toEqual(prefs)
    expect(new storeModule.SettingsStore().get().memoryPrefs).toEqual(prefs)
  })

  it('un set de otro campo hecho sobre lo leído no las pierde', () => {
    const store = new storeModule.SettingsStore()
    store.set({ ...storeModule.DEFAULT_SETTINGS, memoryPrefs: prefs })
    store.set({ ...store.get(), hasSeenMemoriesWelcome: true, voiceLanguage: 'en' })
    const leido = store.get()
    expect(leido.memoryPrefs).toEqual(prefs)
    expect(leido.hasSeenMemoriesWelcome).toBe(true)
    expect(leido.voiceLanguage).toBe('en')
  })
})
