import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { makeTmpDir, cleanupTmp } from './setup'
import { provisionQwenAccount, deprovisionQwenAccount, isQwenAccountProvisioned } from '../memory-provisioner-qwen'
import { adapterForAiType, adapterForBin } from '../memory-cli-adapters'

// qwen needs no isolated identity home like Gemini's GEMINI_CLI_HOME: pty-manager.ts
// already redirects HOME/USERPROFILE to accountDir for every AI pane, and qwen resolves
// its config at os.homedir()/.qwen/settings.json — so accountDir/.qwen/settings.json IS
// qwen's real config file for this account, same non-exclusive merge philosophy as Gemini.
describe('memory-provisioner-qwen', () => {
  let home: string
  let accountDir: string
  let settingsPath: string

  const paths = { execPath: 'C:/fake/electron.exe', shimPath: 'C:/fake/dist-electron/memory-mcp.js' }

  beforeEach(() => {
    home = makeTmpDir('raven-provisioner-qwen-')
    accountDir = join(home, 'accounts', 'qwen', 'Bautista')
    mkdirSync(accountDir, { recursive: true })
    settingsPath = join(accountDir, '.qwen', 'settings.json')
  })

  afterEach(() => cleanupTmp(home))

  it('writes mcpServers.nest_memory into accountDir/.qwen/settings.json, no extra env needed', () => {
    const result = provisionQwenAccount(accountDir, paths, true)

    expect(existsSync(settingsPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(parsed.mcpServers.nest_memory.command).toBe(paths.execPath)
    expect(parsed.mcpServers.nest_memory.args).toEqual([paths.shimPath])
    expect(parsed.mcpServers.nest_memory.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })

    // Unlike Gemini/Codex, qwen needs no CLI flags or env override — HOME redirection
    // (already generic in pty-manager.ts) is the only isolation lever it needs.
    expect(result.env).toBeUndefined()
    expect(result.args).toBeUndefined()
  })

  it('writes the 3 hook events with qwen\'s OWN (Claude-identical) names, timeout in milliseconds', () => {
    provisionQwenAccount(accountDir, paths, true)

    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(parsed.hooks.SessionStart).toBeDefined()
    expect(parsed.hooks.Stop).toBeDefined()
    expect(parsed.hooks.PreCompact).toBeDefined()

    const sessionStartCmd = parsed.hooks.SessionStart[0].hooks[0].command as string
    const stopCmd = parsed.hooks.Stop[0].hooks[0].command as string
    const preCompactCmd = parsed.hooks.PreCompact[0].hooks[0].command as string
    expect(sessionStartCmd).toContain('hook session-start')
    expect(stopCmd).toContain('hook stop')
    expect(preCompactCmd).toContain('hook pre-compact')
    expect(parsed.hooks.SessionStart[0].matcher).toBe('')
    expect(parsed.hooks.SessionStart[0].hooks[0].type).toBe('command')
    // qwen's command-hook `timeout` is documented in MILLISECONDS (default 60000) — unlike
    // Claude/Gemini's seconds. 5000ms keeps the same real-world budget as their `timeout: 5`.
    expect(parsed.hooks.SessionStart[0].hooks[0].timeout).toBe(5000)
  })

  it('is idempotent — provisioning twice does not duplicate hooks or mcpServers', () => {
    provisionQwenAccount(accountDir, paths, true)
    provisionQwenAccount(accountDir, paths, true)

    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(Object.keys(parsed.mcpServers)).toEqual(['nest_memory'])
    expect(parsed.hooks.SessionStart).toHaveLength(1)
    expect(parsed.hooks.Stop).toHaveLength(1)
    expect(parsed.hooks.PreCompact).toHaveLength(1)
  })

  it('respects existing settings.json content — preserves the user\'s own keys and other hooks', () => {
    mkdirSync(join(accountDir, '.qwen'), { recursive: true })
    writeFileSync(
      settingsPath,
      JSON.stringify({
        theme: 'dark',
        mcpServers: { other_server: { command: 'foo' } },
        hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'my-own-hook.sh', timeout: 10000 }] }] },
      }),
    )

    provisionQwenAccount(accountDir, paths, true)

    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(parsed.theme).toBe('dark')
    expect(parsed.mcpServers.other_server).toEqual({ command: 'foo' })
    expect(parsed.mcpServers.nest_memory).toBeDefined()
    // The user's own SessionStart hook survives alongside ours.
    expect(parsed.hooks.SessionStart).toHaveLength(2)
    expect(parsed.hooks.SessionStart.some((e: { hooks: Array<{ command: string }> }) => e.hooks[0].command === 'my-own-hook.sh')).toBe(true)
  })

  it('deprovision removes mcpServers.nest_memory and the 3 hook entries, preserving everything else', () => {
    mkdirSync(join(accountDir, '.qwen'), { recursive: true })
    writeFileSync(
      settingsPath,
      JSON.stringify({
        theme: 'dark',
        mcpServers: { other_server: { command: 'foo' } },
        hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'my-own-hook.sh', timeout: 10000 }] }] },
      }),
    )
    provisionQwenAccount(accountDir, paths, true)

    deprovisionQwenAccount(accountDir)

    expect(existsSync(settingsPath)).toBe(true) // file itself survives — it's not Nest-exclusive
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(parsed.theme).toBe('dark')
    expect(parsed.mcpServers.other_server).toEqual({ command: 'foo' })
    expect(parsed.mcpServers.nest_memory).toBeUndefined()
    // Our SessionStart entry is gone but the user's own survives.
    expect(parsed.hooks.SessionStart).toHaveLength(1)
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe('my-own-hook.sh')
    // Events we own exclusively are removed entirely, not left as empty arrays.
    expect(parsed.hooks.Stop).toBeUndefined()
    expect(parsed.hooks.PreCompact).toBeUndefined()
  })

  it('deprovision removes the Nest-owned .nest/ wrapper dir but leaves .qwen/settings.json alone', () => {
    provisionQwenAccount(accountDir, paths, true)
    expect(existsSync(join(accountDir, '.nest'))).toBe(true)

    deprovisionQwenAccount(accountDir)

    expect(existsSync(join(accountDir, '.nest'))).toBe(false)
    expect(existsSync(settingsPath)).toBe(true)
  })

  it('deprovision is a no-op (does not throw) when nothing was ever provisioned', () => {
    expect(() => deprovisionQwenAccount(accountDir)).not.toThrow()
  })

  it('isQwenAccountProvisioned reflects provision/deprovision state', () => {
    expect(isQwenAccountProvisioned(accountDir)).toBe(false)
    provisionQwenAccount(accountDir, paths, true)
    expect(isQwenAccountProvisioned(accountDir)).toBe(true)
    deprovisionQwenAccount(accountDir)
    expect(isQwenAccountProvisioned(accountDir)).toBe(false)
  })

  it('is registered in the adapter registry by aiType and by bin name', () => {
    expect(adapterForAiType('qwen')?.aiType).toBe('qwen')
    expect(adapterForBin('qwen')?.aiType).toBe('qwen')
  })

  it('the adapter.provision() return shape carries neither args nor env (qwen needs no CLI flags or env override)', () => {
    const adapter = adapterForAiType('qwen')!
    const result = adapter.provision(accountDir, paths, true)
    expect(result.args).toBeUndefined()
    expect(result.env).toBeUndefined()
  })
})
