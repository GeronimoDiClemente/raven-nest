import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { makeTmpDir, cleanupTmp } from './setup'
import { provisionCodexAccount, deprovisionCodexAccount, isCodexAccountProvisioned } from '../memory-provisioner-codex'
import { adapterForAiType, adapterForBin } from '../memory-cli-adapters'

// Minimal, purpose-built TOML reader for exactly the shape memory-provisioner-codex.ts's
// buildConfigToml() emits (no general TOML library, per the retomada plan). Not a general
// TOML parser — it would choke on config.toml files written by hand or by Codex itself in
// a different shape. That's fine: this module owns the whole file (see its header), so the
// only shape it ever needs to read back is its own output.
function parseCodexConfigToml(content: string) {
  const result: {
    mcpServers: { nest_memory?: { command?: string; args?: string[]; env?: Record<string, string> } }
    hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ type?: string; command?: string; timeout?: number }> }>>
  } = { mcpServers: {}, hooks: {} }

  let section: 'none' | 'mcp' | 'env' | 'hookEvent' | 'hookEntry' = 'none'
  let currentEventObj: { matcher?: string; hooks: Array<{ type?: string; command?: string; timeout?: number }> } | null = null
  let currentHookEntry: { type?: string; command?: string; timeout?: number } | null = null

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    let m: RegExpMatchArray | null

    if (line === '[mcp_servers.nest_memory]') {
      result.mcpServers.nest_memory = {}
      section = 'mcp'
      continue
    }
    if (line === '[mcp_servers.nest_memory.env]') {
      result.mcpServers.nest_memory = result.mcpServers.nest_memory ?? {}
      result.mcpServers.nest_memory.env = {}
      section = 'env'
      continue
    }
    if ((m = line.match(/^\[\[hooks\.(\w+)\]\]$/))) {
      currentEventObj = { hooks: [] }
      result.hooks[m[1]] = result.hooks[m[1]] ?? []
      result.hooks[m[1]].push(currentEventObj)
      section = 'hookEvent'
      continue
    }
    if ((m = line.match(/^\[\[hooks\.\w+\.hooks\]\]$/))) {
      currentHookEntry = {}
      currentEventObj!.hooks.push(currentHookEntry)
      section = 'hookEntry'
      continue
    }
    if (section === 'mcp') {
      if ((m = line.match(/^command = '(.*)'$/))) { result.mcpServers.nest_memory!.command = m[1]; continue }
      if ((m = line.match(/^args = \['(.*)'\]$/))) { result.mcpServers.nest_memory!.args = [m[1]]; continue }
    }
    if (section === 'env') {
      if ((m = line.match(/^ELECTRON_RUN_AS_NODE = "(.*)"$/))) { result.mcpServers.nest_memory!.env!.ELECTRON_RUN_AS_NODE = m[1]; continue }
    }
    if (section === 'hookEvent') {
      if ((m = line.match(/^matcher = "(.*)"$/))) { currentEventObj!.matcher = m[1]; continue }
    }
    if (section === 'hookEntry') {
      if ((m = line.match(/^type = "(.*)"$/))) { currentHookEntry!.type = m[1]; continue }
      if ((m = line.match(/^command = '(.*)'$/))) { currentHookEntry!.command = m[1]; continue }
      if ((m = line.match(/^timeout = (\d+)$/))) { currentHookEntry!.timeout = Number(m[1]); continue }
    }
  }
  return result
}

describe('memory-provisioner-codex', () => {
  let home: string
  let accountDir: string
  let configPath: string

  const paths = { execPath: 'C:/fake/electron.exe', shimPath: 'C:/fake/dist-electron/memory-mcp.js' }

  beforeEach(() => {
    home = makeTmpDir('raven-provisioner-codex-')
    accountDir = join(home, 'accounts', 'codex', 'Bautista')
    mkdirSync(accountDir, { recursive: true })
    configPath = join(accountDir, '.nest', 'codex-home', 'config.toml')
  })

  afterEach(() => cleanupTmp(home))

  it('writes a parseable config.toml with mcp_servers.nest_memory in a NEW isolated codex-home', () => {
    const result = provisionCodexAccount(accountDir, paths, true)

    expect(existsSync(configPath)).toBe(true)
    const parsed = parseCodexConfigToml(readFileSync(configPath, 'utf8'))
    expect(parsed.mcpServers.nest_memory?.command).toBe(paths.execPath)
    expect(parsed.mcpServers.nest_memory?.args).toEqual([paths.shimPath])
    expect(parsed.mcpServers.nest_memory?.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })

    // Isolated home, not a second lever on a pre-existing identity home (there is none for
    // Codex — see the module header) — and never derived from HOME/USERPROFILE.
    expect(result.env.CODEX_HOME).toBe(join(accountDir, '.nest', 'codex-home'))
    expect(result.args).toEqual(['--dangerously-bypass-hook-trust'])
  })

  it('writes the 3 hook events with the shim subcommands and the SessionStart matcher', () => {
    provisionCodexAccount(accountDir, paths, true)

    const parsed = parseCodexConfigToml(readFileSync(configPath, 'utf8'))
    expect(parsed.hooks.SessionStart).toHaveLength(1)
    expect(parsed.hooks.Stop).toHaveLength(1)
    expect(parsed.hooks.PreCompact).toHaveLength(1)

    expect(parsed.hooks.SessionStart[0].matcher).toBe('startup|resume')
    expect(parsed.hooks.Stop[0].matcher).toBeUndefined()
    expect(parsed.hooks.PreCompact[0].matcher).toBeUndefined()

    const sessionStart = parsed.hooks.SessionStart[0].hooks[0]
    const stop = parsed.hooks.Stop[0].hooks[0]
    const preCompact = parsed.hooks.PreCompact[0].hooks[0]
    expect(sessionStart.type).toBe('command')
    expect(sessionStart.timeout).toBe(5)
    expect(sessionStart.command).toContain('hook session-start')
    expect(stop.command).toContain('hook stop')
    expect(preCompact.command).toContain('hook pre-compact')
  })

  it('is idempotent — provisioning twice leaves exactly one block per hook event, no duplication', () => {
    provisionCodexAccount(accountDir, paths, true)
    provisionCodexAccount(accountDir, paths, true)

    const parsed = parseCodexConfigToml(readFileSync(configPath, 'utf8'))
    expect(parsed.hooks.SessionStart).toHaveLength(1)
    expect(parsed.hooks.Stop).toHaveLength(1)
    expect(parsed.hooks.PreCompact).toHaveLength(1)
    expect(Object.keys(parsed.mcpServers)).toEqual(['nest_memory'])
  })

  it('deprovision removes {accountDir}/.nest entirely (wrapper + codex-home) and touches nothing outside it', () => {
    provisionCodexAccount(accountDir, paths, true)
    expect(existsSync(join(accountDir, '.nest'))).toBe(true)
    expect(existsSync(configPath)).toBe(true)

    // Sibling content in accountDir must survive deprovision untouched.
    const siblingMarker = join(accountDir, 'unrelated-marker.txt')
    writeFileSync(siblingMarker, 'do not touch')

    deprovisionCodexAccount(accountDir)

    expect(existsSync(join(accountDir, '.nest'))).toBe(false)
    expect(existsSync(configPath)).toBe(false)
    expect(existsSync(siblingMarker)).toBe(true)
  })

  it('deprovision is a no-op (does not throw) when nothing was ever provisioned', () => {
    expect(() => deprovisionCodexAccount(accountDir)).not.toThrow()
  })

  it('isCodexAccountProvisioned reflects provision/deprovision state', () => {
    expect(isCodexAccountProvisioned(accountDir)).toBe(false)
    provisionCodexAccount(accountDir, paths, true)
    expect(isCodexAccountProvisioned(accountDir)).toBe(true)
    deprovisionCodexAccount(accountDir)
    expect(isCodexAccountProvisioned(accountDir)).toBe(false)
  })

  it('is registered in the adapter registry by aiType and by bin name', () => {
    expect(adapterForAiType('codex')?.aiType).toBe('codex')
    expect(adapterForBin('codex')?.aiType).toBe('codex')
  })

  it('the adapter.provision() return shape carries CODEX_HOME env and the bypass-hook-trust arg', () => {
    const adapter = adapterForAiType('codex')!
    const result = adapter.provision(accountDir, paths, true)
    expect(result.env?.CODEX_HOME).toBe(join(accountDir, '.nest', 'codex-home'))
    expect(result.args).toEqual(['--dangerously-bypass-hook-trust'])
  })
})
