import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { makeTmpDir, cleanupTmp } from './setup'
import { provisionOpencodeAccount, deprovisionOpencodeAccount, isOpencodeAccountProvisioned } from '../memory-provisioner-opencode'
import { adapterForAiType, adapterForBin } from '../memory-cli-adapters'

// opencode needs no isolated identity home like Gemini's GEMINI_CLI_HOME: pty-manager.ts
// already redirects HOME/USERPROFILE to accountDir for every AI pane, and opencode resolves
// its config at os.homedir()/.config/opencode/opencode.jsonc — so
// accountDir/.config/opencode/opencode.jsonc IS opencode's real config file for this
// account (same non-exclusive-file principle as Gemini's and qwen's settings.json).
describe('memory-provisioner-opencode', () => {
  let home: string
  let accountDir: string
  let configPath: string

  const paths = { execPath: 'C:/fake/electron.exe', shimPath: 'C:/fake/dist-electron/memory-mcp.js' }

  beforeEach(() => {
    home = makeTmpDir('raven-provisioner-opencode-')
    accountDir = join(home, 'accounts', 'opencode', 'Bautista')
    mkdirSync(accountDir, { recursive: true })
    configPath = join(accountDir, '.config', 'opencode', 'opencode.jsonc')
  })

  afterEach(() => cleanupTmp(home))

  it('writes mcp.nest_memory into accountDir/.config/opencode/opencode.jsonc when the file does not exist yet', () => {
    const result = provisionOpencodeAccount(accountDir, paths, true)

    expect(existsSync(configPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(parsed.mcp.nest_memory).toEqual({
      type: 'local',
      command: [paths.execPath, paths.shimPath],
      environment: { ELECTRON_RUN_AS_NODE: '1' },
    })
    // Unlike Gemini/Codex, opencode needs no CLI flags or env override — HOME redirection
    // (already generic in pty-manager.ts) is the only isolation lever it needs.
    expect(result.args).toBeUndefined()
    expect(result.env).toBeUndefined()
  })

  it('is idempotent — provisioning twice does not duplicate or corrupt the entry', () => {
    provisionOpencodeAccount(accountDir, paths, true)
    provisionOpencodeAccount(accountDir, paths, true)

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(Object.keys(parsed.mcp)).toEqual(['nest_memory'])
  })

  it('preserves other keys and other mcp servers already in the file', () => {
    mkdirSync(join(accountDir, '.config', 'opencode'), { recursive: true })
    writeFileSync(
      configPath,
      JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        username: 'gerod',
        mcp: { other_server: { type: 'local', command: ['foo'] } },
      }),
    )

    provisionOpencodeAccount(accountDir, paths, true)

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(parsed.username).toBe('gerod')
    expect(parsed.mcp.other_server).toEqual({ type: 'local', command: ['foo'] })
    expect(parsed.mcp.nest_memory).toBeDefined()
  })

  it('preserves a real // comment in the file — the reason this module uses jsonc-parser instead of JSON.parse/stringify', () => {
    mkdirSync(join(accountDir, '.config', 'opencode'), { recursive: true })
    writeFileSync(configPath, '{\n  // my own note about this config\n  "username": "gerod"\n}\n')

    provisionOpencodeAccount(accountDir, paths, true)

    const raw = readFileSync(configPath, 'utf8')
    expect(raw).toContain('// my own note about this config')
  })

  it('deprovision removes mcp.nest_memory but preserves other keys and other mcp servers', () => {
    mkdirSync(join(accountDir, '.config', 'opencode'), { recursive: true })
    writeFileSync(
      configPath,
      JSON.stringify({
        username: 'gerod',
        mcp: { other_server: { type: 'local', command: ['foo'] } },
      }),
    )
    provisionOpencodeAccount(accountDir, paths, true)

    deprovisionOpencodeAccount(accountDir)

    expect(existsSync(configPath)).toBe(true) // file itself survives — it's not Nest-exclusive
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(parsed.username).toBe('gerod')
    expect(parsed.mcp.other_server).toEqual({ type: 'local', command: ['foo'] })
    expect(parsed.mcp.nest_memory).toBeUndefined()
  })

  it('deprovision preserves a real // comment in the file', () => {
    mkdirSync(join(accountDir, '.config', 'opencode'), { recursive: true })
    writeFileSync(configPath, '{\n  // my own note about this config\n  "username": "gerod"\n}\n')
    provisionOpencodeAccount(accountDir, paths, true)

    deprovisionOpencodeAccount(accountDir)

    const raw = readFileSync(configPath, 'utf8')
    expect(raw).toContain('// my own note about this config')
  })

  it('deprovision is a no-op (does not throw, does not create the file) when nothing was ever provisioned', () => {
    expect(() => deprovisionOpencodeAccount(accountDir)).not.toThrow()
    expect(existsSync(configPath)).toBe(false)
  })

  it('isOpencodeAccountProvisioned reflects provision/deprovision state', () => {
    expect(isOpencodeAccountProvisioned(accountDir)).toBe(false)
    provisionOpencodeAccount(accountDir, paths, true)
    expect(isOpencodeAccountProvisioned(accountDir)).toBe(true)
    deprovisionOpencodeAccount(accountDir)
    expect(isOpencodeAccountProvisioned(accountDir)).toBe(false)
  })

  it('isOpencodeAccountProvisioned is not fooled by a real $schema URL containing //', () => {
    mkdirSync(join(accountDir, '.config', 'opencode'), { recursive: true })
    writeFileSync(configPath, JSON.stringify({ $schema: 'https://opencode.ai/config.json' }))

    expect(isOpencodeAccountProvisioned(accountDir)).toBe(false)
    provisionOpencodeAccount(accountDir, paths, true)
    expect(isOpencodeAccountProvisioned(accountDir)).toBe(true)
  })

  it('provision throws instead of overwriting when opencode.jsonc is genuinely corrupted (not just JSONC comments/trailing commas)', () => {
    mkdirSync(join(accountDir, '.config', 'opencode'), { recursive: true })
    writeFileSync(configPath, '{ this is not valid json or jsonc at all ][')

    expect(() => provisionOpencodeAccount(accountDir, paths, true)).toThrow()
    // The corrupted content must survive untouched — never silently replaced with a fresh document.
    expect(readFileSync(configPath, 'utf8')).toBe('{ this is not valid json or jsonc at all ][')
  })

  it('provision does NOT throw for valid JSONC quirks — comments and trailing commas', () => {
    mkdirSync(join(accountDir, '.config', 'opencode'), { recursive: true })
    writeFileSync(configPath, '{\n  // a comment\n  "username": "gerod",\n}\n')

    expect(() => provisionOpencodeAccount(accountDir, paths, true)).not.toThrow()
  })

  it('is registered in the adapter registry by aiType and by bin name', () => {
    expect(adapterForAiType('opencode')?.aiType).toBe('opencode')
    expect(adapterForBin('opencode')?.aiType).toBe('opencode')
  })

  it('the adapter.provision() return shape carries neither args nor env', () => {
    const adapter = adapterForAiType('opencode')!
    const result = adapter.provision(accountDir, paths, true)
    expect(result.args).toBeUndefined()
    expect(result.env).toBeUndefined()
  })
})
