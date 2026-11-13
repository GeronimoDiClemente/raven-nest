import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { makeTmpDir, cleanupTmp } from './setup'
import { provisionGeminiAccount, deprovisionGeminiAccount, isGeminiAccountProvisioned } from '../memory-provisioner-gemini'
import { adapterForAiType, adapterForBin } from '../memory-cli-adapters'

// Regression coverage for the design deviation documented in
// memory-provisioner-gemini.ts's header: provisioning must land in Gemini's EXISTING
// per-account identity home (`{accountDir}/gemini/.gemini/settings.json`, the same one
// pty-manager.ts already points GEMINI_CLI_HOME at), not a second Nest-exclusive home, and
// deprovision must surgically remove only Nest's own entries rather than deleting that file.
describe('memory-provisioner-gemini', () => {
  let home: string
  let accountDir: string
  let settingsPath: string

  const paths = { execPath: 'C:/fake/electron.exe', shimPath: 'C:/fake/dist-electron/memory-mcp.js' }

  beforeEach(() => {
    home = makeTmpDir('raven-provisioner-gemini-')
    accountDir = join(home, 'accounts', 'gemini', 'Bautista')
    mkdirSync(accountDir, { recursive: true })
    settingsPath = join(accountDir, 'gemini', '.gemini', 'settings.json')
  })

  afterEach(() => cleanupTmp(home))

  it('writes mcpServers.nest_memory into the EXISTING gemini identity home, not a new isolated one', () => {
    const result = provisionGeminiAccount(accountDir, paths, true)

    expect(existsSync(settingsPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(parsed.mcpServers.nest_memory.command).toBe(paths.execPath)
    expect(parsed.mcpServers.nest_memory.args).toEqual([paths.shimPath])
    expect(parsed.mcpServers.nest_memory.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })

    // The returned env must point GEMINI_CLI_HOME at {accountDir}/gemini — the same
    // directory pty-manager.ts's `cmd === 'gemini'` block already redirects to, never a
    // separate `.nest/gemini-home`.
    expect(result.env.GEMINI_CLI_HOME).toBe(join(accountDir, 'gemini'))
  })

  it('writes the 3 hook events mapped to Gemini names, with the shim subcommands unchanged', () => {
    provisionGeminiAccount(accountDir, paths, true)

    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(parsed.hooks.SessionStart).toBeDefined()
    expect(parsed.hooks.AfterAgent).toBeDefined()
    expect(parsed.hooks.PreCompress).toBeDefined()
    // Claude's own event names must NOT appear — they mean something different in Gemini
    // (or nothing at all).
    expect(parsed.hooks.Stop).toBeUndefined()
    expect(parsed.hooks.PreCompact).toBeUndefined()

    const sessionStartCmd = parsed.hooks.SessionStart[0].hooks[0].command as string
    const afterAgentCmd = parsed.hooks.AfterAgent[0].hooks[0].command as string
    const preCompressCmd = parsed.hooks.PreCompress[0].hooks[0].command as string
    expect(sessionStartCmd).toContain('hook session-start')
    expect(afterAgentCmd).toContain('hook stop')
    expect(preCompressCmd).toContain('hook pre-compact')
    expect(parsed.hooks.SessionStart[0].matcher).toBe('')
    expect(parsed.hooks.SessionStart[0].hooks[0].type).toBe('command')
    expect(parsed.hooks.SessionStart[0].hooks[0].timeout).toBe(5)
  })

  it('is idempotent — provisioning twice does not duplicate hooks or mcpServers', () => {
    provisionGeminiAccount(accountDir, paths, true)
    provisionGeminiAccount(accountDir, paths, true)

    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(Object.keys(parsed.mcpServers)).toEqual(['nest_memory'])
    expect(parsed.hooks.SessionStart).toHaveLength(1)
    expect(parsed.hooks.AfterAgent).toHaveLength(1)
    expect(parsed.hooks.PreCompress).toHaveLength(1)
  })

  it('respects existing settings.json content — preserves the user\'s own keys and other hooks', () => {
    mkdirSync(join(accountDir, 'gemini', '.gemini'), { recursive: true })
    writeFileSync(
      settingsPath,
      JSON.stringify({
        theme: 'dark',
        mcpServers: { other_server: { command: 'foo' } },
        hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'my-own-hook.sh', timeout: 10 }] }] },
      }),
    )

    provisionGeminiAccount(accountDir, paths, true)

    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(parsed.theme).toBe('dark')
    expect(parsed.mcpServers.other_server).toEqual({ command: 'foo' })
    expect(parsed.mcpServers.nest_memory).toBeDefined()
    // The user's own SessionStart hook survives alongside ours.
    expect(parsed.hooks.SessionStart).toHaveLength(2)
    expect(parsed.hooks.SessionStart.some((e: { hooks: Array<{ command: string }> }) => e.hooks[0].command === 'my-own-hook.sh')).toBe(true)
  })

  it('deprovision removes mcpServers.nest_memory and the 3 hook entries, preserving everything else', () => {
    mkdirSync(join(accountDir, 'gemini', '.gemini'), { recursive: true })
    writeFileSync(
      settingsPath,
      JSON.stringify({
        theme: 'dark',
        mcpServers: { other_server: { command: 'foo' } },
        hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'my-own-hook.sh', timeout: 10 }] }] },
      }),
    )
    provisionGeminiAccount(accountDir, paths, true)

    deprovisionGeminiAccount(accountDir)

    expect(existsSync(settingsPath)).toBe(true) // file itself survives — it's not Nest-exclusive
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(parsed.theme).toBe('dark')
    expect(parsed.mcpServers.other_server).toEqual({ command: 'foo' })
    expect(parsed.mcpServers.nest_memory).toBeUndefined()
    // Our SessionStart entry is gone but the user's own survives.
    expect(parsed.hooks.SessionStart).toHaveLength(1)
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe('my-own-hook.sh')
    // Events we own exclusively are removed entirely, not left as empty arrays.
    expect(parsed.hooks.AfterAgent).toBeUndefined()
    expect(parsed.hooks.PreCompress).toBeUndefined()
  })

  it('deprovision removes the Nest-owned .nest/ wrapper dir but leaves the gemini identity home alone', () => {
    provisionGeminiAccount(accountDir, paths, true)
    expect(existsSync(join(accountDir, '.nest'))).toBe(true)

    deprovisionGeminiAccount(accountDir)

    expect(existsSync(join(accountDir, '.nest'))).toBe(false)
    expect(existsSync(join(accountDir, 'gemini'))).toBe(true)
    expect(existsSync(settingsPath)).toBe(true)
  })

  it('deprovision is a no-op (does not throw) when nothing was ever provisioned', () => {
    expect(() => deprovisionGeminiAccount(accountDir)).not.toThrow()
  })

  it('isGeminiAccountProvisioned reflects provision/deprovision state', () => {
    expect(isGeminiAccountProvisioned(accountDir)).toBe(false)
    provisionGeminiAccount(accountDir, paths, true)
    expect(isGeminiAccountProvisioned(accountDir)).toBe(true)
    deprovisionGeminiAccount(accountDir)
    expect(isGeminiAccountProvisioned(accountDir)).toBe(false)
  })

  it('is registered in the adapter registry by aiType and by bin name', () => {
    expect(adapterForAiType('gemini')?.aiType).toBe('gemini')
    expect(adapterForBin('gemini')?.aiType).toBe('gemini')
  })

  it('the adapter.provision() return shape carries only env, no args (gemini needs no CLI flags)', () => {
    const adapter = adapterForAiType('gemini')!
    const result = adapter.provision(accountDir, paths, true)
    expect(result.args).toBeUndefined()
    expect(result.env?.GEMINI_CLI_HOME).toBe(join(accountDir, 'gemini'))
  })
})

// Regression test for the explicitly-forbidden shortcut: `gemini hooks migrate --from-claude`
// must never be invoked anywhere in the codebase. Verified manually (see the module header)
// that it reads from {cwd}/.claude/settings.json, always writes to PROJECT scope, and is a
// silent no-op with a false success message when cwd === HOME — none of which this
// provisioner can tolerate.
describe('memory-provisioner-gemini — never shells out to `gemini hooks migrate`', () => {
  it('the module source does not reference the migrate subcommand', () => {
    const source = readFileSync(join(__dirname, '..', 'memory-provisioner-gemini.ts'), 'utf8')
    const codeOnly = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(codeOnly).not.toMatch(/hooks\s+migrate/)
    expect(codeOnly).not.toMatch(/exec(Sync)?\s*\(\s*['"`]gemini/)
    expect(codeOnly).not.toMatch(/spawn(Sync)?\s*\(\s*['"`]gemini/)
  })

  it('the adapter registry source does not reference the migrate subcommand either', () => {
    const source = readFileSync(join(__dirname, '..', 'memory-cli-adapters.ts'), 'utf8')
    expect(source).not.toMatch(/hooks\s+migrate/)
  })
})
