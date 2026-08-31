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

import { writeFileSync, mkdirSync as mkdirSync2 } from 'fs'
import { importVSCodeConfig, importIntelliJConfig } from '../ide-config-bridge'

describe('importVSCodeConfig', () => {
  let root: string
  afterEach(() => cleanupTmp(root))

  it('reads and parses settings.json from the resolved path', async () => {
    root = makeTmpDir('vscode-home-')
    const userDir = join(root, '.config', 'Code', 'User')
    mkdirSync2(userDir, { recursive: true })
    writeFileSync(join(userDir, 'settings.json'), JSON.stringify({ 'editor.fontSize': 18 }))

    const result = await importVSCodeConfig(root, 'linux')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.options.fontSize).toBe(18)
  })

  it('returns a not-found error when settings.json does not exist', async () => {
    root = makeTmpDir('vscode-home-empty-')
    const result = await importVSCodeConfig(root, 'linux')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("couldn't find")
  })
})

describe('importIntelliJConfig', () => {
  let root: string
  afterEach(() => cleanupTmp(root))

  it('reads and parses editor.xml (and code style, if present) from the newest version dir', async () => {
    root = makeTmpDir('jetbrains-home-')
    const optionsDir = join(root, '.config', 'JetBrains', 'IntelliJIdea2025.1', 'options')
    mkdirSync2(optionsDir, { recursive: true })
    writeFileSync(
      join(optionsDir, 'editor.xml'),
      '<application><component name="EditorSettings"><option name="FONT_SIZE" value="17" /></component></application>',
    )
    const result = await importIntelliJConfig(root, 'linux')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.options.fontSize).toBe(17)
  })

  it('returns a not-found error when no JetBrains install is found', async () => {
    root = makeTmpDir('jetbrains-home-empty-')
    const result = await importIntelliJConfig(root, 'linux')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("couldn't find")
  })
})
