import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'

describe('session-store', () => {
  let home: string
  let mod: typeof import('../session-store')

  beforeEach(async () => {
    home = makeTmpDir('raven-session-')
    process.env.RAVEN_HOME = home
    vi.resetModules()
    mod = await import('../session-store')
  })

  afterEach(() => {
    delete process.env.RAVEN_HOME
    cleanupTmp(home)
  })

  const sessionDir = () => join(home, '.raven-nest')

  it('save + load round-trip', () => {
    const data = { tabs: [{ id: 't1', name: 'Workspace', panes: [] }], activeTabId: 't1' }
    mod.saveSession(data)
    expect(mod.loadSession()).toEqual(data)
  })

  it('load returns null on first launch (no file)', () => {
    expect(mod.loadSession()).toBeNull()
  })

  it('load returns null on corrupt file instead of throwing', () => {
    mkdirSync(sessionDir(), { recursive: true })
    writeFileSync(join(sessionDir(), 'session.json'), '{truncated')
    expect(mod.loadSession()).toBeNull()
  })

  it('a failed save leaves the previous session intact (no partial write)', () => {
    const good = { tabs: [{ id: 't1' }], activeTabId: 't1' }
    mod.saveSession(good)

    // JSON.stringify throws on circular data — the write must fail BEFORE
    // touching session.json, not after truncating it.
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => mod.saveSession(circular)).toThrow()

    expect(mod.loadSession()).toEqual(good)
  })

  it('save does not leave tmp files behind', () => {
    mod.saveSession({ tabs: [], activeTabId: null })
    const leftovers = readdirSync(sessionDir()).filter((f) => f !== 'session.json')
    expect(leftovers).toEqual([])
  })

  it('save is readable as plain JSON on disk', () => {
    mod.saveSession({ activeTabId: 'x' })
    const raw = readFileSync(join(sessionDir(), 'session.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual({ activeTabId: 'x' })
  })
})
