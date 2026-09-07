import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join, sep } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import {
  defaultVaultSettings,
  defaultVaultRoot,
  vaultSettingsPath,
  loadVaultSettings,
  saveVaultSettings,
  resolveVaultRootDir,
  validateVaultRoot,
} from '../integrations/vault-config'

let dirs: string[] = []
function tmp(): string {
  const d = makeTmpDir('vault-config-')
  dirs.push(d)
  return d
}
afterEach(() => { dirs.forEach(cleanupTmp); dirs = [] })

describe('vault-config', () => {
  it('missing settings file loads as defaults (vault off)', () => {
    const home = tmp()
    const settings = loadVaultSettings(vaultSettingsPath(home, 'user-1'))
    expect(settings).toEqual(defaultVaultSettings())
  })

  it('corrupt JSON loads as defaults instead of throwing', () => {
    const home = tmp()
    const path = vaultSettingsPath(home, 'user-1')
    mkdirSync(join(home, '.raven-nest', 'memory-vault-settings'), { recursive: true })
    writeFileSync(path, 'not json at all {{{')
    expect(loadVaultSettings(path)).toEqual(defaultVaultSettings())
  })

  it('save then load round-trips', () => {
    const home = tmp()
    const path = vaultSettingsPath(home, 'user-1')
    const settings = { version: 1, enabled: true, root: '/custom/root', includeSuperseded: false, includeTeamScope: false }
    saveVaultSettings(path, settings)
    expect(loadVaultSettings(path)).toEqual(settings)
  })

  it('different accounts on the same home get different settings paths and never see each other\'s state', () => {
    const home = tmp()
    saveVaultSettings(vaultSettingsPath(home, 'user-1'), { ...defaultVaultSettings(), enabled: true })
    const other = loadVaultSettings(vaultSettingsPath(home, 'user-2'))
    expect(other.enabled).toBe(false)
  })

  it('defaultVaultRoot is per-account and outside .raven-nest/memory/', () => {
    const home = tmp()
    const a = defaultVaultRoot(home, 'user-1')
    const b = defaultVaultRoot(home, 'user-2')
    expect(a).not.toBe(b)
    expect(a).not.toContain(join('.raven-nest', 'memory') + sep)
    expect(a.includes(join('.raven-nest', 'memory-vault'))).toBe(true)
  })

  it('a no-session (_local) root differs from any real account root', () => {
    const home = tmp()
    expect(defaultVaultRoot(home, null)).not.toBe(defaultVaultRoot(home, 'user-1'))
  })

  it('resolveVaultRootDir: null root falls back to the default, a custom root wins', () => {
    const home = tmp()
    expect(resolveVaultRootDir(home, 'user-1', defaultVaultSettings())).toBe(defaultVaultRoot(home, 'user-1'))
    const custom = { ...defaultVaultSettings(), root: '/somewhere/else' }
    expect(resolveVaultRootDir(home, 'user-1', custom)).toBe('/somewhere/else')
  })

  it('validateVaultRoot rejects a root nested under a real .git directory on disk', () => {
    const home = tmp()
    const repoRoot = join(home, 'some-repo')
    mkdirSync(join(repoRoot, '.git'), { recursive: true })
    const candidate = join(repoRoot, 'notes')
    const result = validateVaultRoot(candidate, { ravenHomeDir: home, accountClaudeDirs: [], enrolledRepoRoots: [], platform: 'linux' })
    expect(result.forbidden).toBe(true)
  })

  it('validateVaultRoot accepts a plain directory with no .git ancestor', () => {
    const home = tmp()
    const candidate = join(home, '.raven-nest', 'memory-vault', 'user-1')
    const result = validateVaultRoot(candidate, { ravenHomeDir: home, accountClaudeDirs: [], enrolledRepoRoots: [], platform: 'linux' })
    expect(result.forbidden).toBe(false)
  })
})
