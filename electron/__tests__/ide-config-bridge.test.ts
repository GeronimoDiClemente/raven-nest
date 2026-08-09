import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, utimesSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { resolveVSCodeSettingsPath, resolveJetBrainsRoot, findIntelliJConfigDir } from '../ide-config-bridge'

describe('resolveVSCodeSettingsPath', () => {
  it('builds the Windows path under AppData/Code/User', () => {
    expect(resolveVSCodeSettingsPath('C:\\Users\\bauti', 'win32'))
      .toBe('C:\\Users\\bauti\\AppData\\Roaming\\Code\\User\\settings.json')
  })

  it('builds the Linux path under .config/Code/User', () => {
    expect(resolveVSCodeSettingsPath('/home/bauti', 'linux'))
      .toBe('/home/bauti/.config/Code/User/settings.json')
  })

  it('builds the Mac path under Library/Application Support', () => {
    expect(resolveVSCodeSettingsPath('/Users/bauti', 'darwin'))
      .toBe('/Users/bauti/Library/Application Support/Code/User/settings.json')
  })
})

describe('resolveJetBrainsRoot', () => {
  it('builds the Windows JetBrains root', () => {
    expect(resolveJetBrainsRoot('C:\\Users\\bauti', 'win32')).toBe('C:\\Users\\bauti\\AppData\\Roaming\\JetBrains')
  })
})

describe('findIntelliJConfigDir', () => {
  let root: string

  afterEach(() => cleanupTmp(root))

  it('returns null when no IntelliJIdea* directory exists', async () => {
    root = makeTmpDir('jetbrains-')
    await expect(findIntelliJConfigDir(root)).resolves.toBeNull()
  })

  it('picks the most recently modified IntelliJIdea* directory when several exist', async () => {
    root = makeTmpDir('jetbrains-')
    const older = join(root, 'IntelliJIdea2024.3')
    const newer = join(root, 'IntelliJIdea2025.1')
    mkdirSync(older)
    mkdirSync(newer)
    const now = Date.now() / 1000
    utimesSync(older, now - 100, now - 100)
    utimesSync(newer, now, now)
    await expect(findIntelliJConfigDir(root)).resolves.toBe(newer)
  })

  it('ignores directories that do not match the IntelliJIdea* pattern', async () => {
    root = makeTmpDir('jetbrains-')
    mkdirSync(join(root, 'PyCharm2025.1'))
    await expect(findIntelliJConfigDir(root)).resolves.toBeNull()
  })
})
