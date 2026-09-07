import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { makeTmpDir, cleanupTmp } from './setup'
import { provisionOpencodeAccount } from '../memory-provisioner-opencode'

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
})
