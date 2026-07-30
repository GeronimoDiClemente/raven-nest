import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs'
import { makeTmpDir, cleanupTmp } from './setup'
import {
  provisionClaudeAccount,
  deprovisionClaudeAccount,
  claudeSettingsFlagArgs,
  isClaudeAccountProvisioned,
} from '../memory-provisioner'

// Regression test for the shared-config hazard documented in
// docs/nest-memory-architecture.md §2.5 (risk R-2, Phase 1 acceptance criterion #6):
// the provisioner must NEVER touch a Claude account's .claude/settings.json, because
// that file is frequently a symlink/hardlink back to the user's global
// ~/.claude/settings.json. Mutating it would pollute every Claude Code session on the
// machine, inside Nest or not.
describe('memory-provisioner — settings isolation', () => {
  let home: string
  let accountDir: string
  let globalSettingsPath: string

  const paths = { execPath: 'C:/fake/electron.exe', shimPath: 'C:/fake/dist-electron/memory-mcp.js' }

  beforeEach(() => {
    home = makeTmpDir('raven-provisioner-')
    accountDir = join(home, 'accounts', 'claude', 'Bautista')
    mkdirSync(accountDir, { recursive: true })
    mkdirSync(join(accountDir, '.claude'), { recursive: true })
    globalSettingsPath = join(accountDir, '.claude', 'settings.json')
    // Simulate the account-store symlink target: content that would be corrupted if
    // the provisioner ever opened this file for read-modify-write.
    writeFileSync(globalSettingsPath, JSON.stringify({ userPreexistingSetting: true, hooks: { Foo: 'bar' } }, null, 2))
  })

  afterEach(() => cleanupTmp(home))

  it('never creates or modifies .claude/settings.json', () => {
    const before = readFileSync(globalSettingsPath)

    provisionClaudeAccount(accountDir, paths, true)

    const after = readFileSync(globalSettingsPath)
    expect(Buffer.compare(before, after)).toBe(0) // byte-for-byte identical
  })

  it('provision then deprovision leaves .claude/settings.json byte-identical', () => {
    const before = readFileSync(globalSettingsPath)

    provisionClaudeAccount(accountDir, paths, true)
    deprovisionClaudeAccount(accountDir)

    const after = readFileSync(globalSettingsPath)
    expect(Buffer.compare(before, after)).toBe(0)
  })

  it('writes hooks only into the isolated .nest/memory-settings.json', () => {
    provisionClaudeAccount(accountDir, paths, true)

    const settingsPath = join(accountDir, '.nest', 'memory-settings.json')
    expect(existsSync(settingsPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(parsed._nest).toBe('memory')
    expect(parsed.hooks.SessionStart).toBeDefined()
    expect(parsed.hooks.Stop).toBeDefined()
    expect(parsed.hooks.PreCompact).toBeDefined()
  })

  it('writes mcpServers.nest_memory into .claude.json, not .claude/settings.json', () => {
    provisionClaudeAccount(accountDir, paths, true)

    const claudeJsonPath = join(accountDir, '.claude.json')
    expect(existsSync(claudeJsonPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(claudeJsonPath, 'utf8'))
    expect(parsed.mcpServers.nest_memory.command).toBe(paths.execPath)
    expect(parsed.mcpServers.nest_memory.args).toEqual([paths.shimPath])
  })

  it('claudeSettingsFlagArgs returns --settings only when provisioned', () => {
    expect(claudeSettingsFlagArgs(accountDir)).toEqual([])
    provisionClaudeAccount(accountDir, paths, true)
    const args = claudeSettingsFlagArgs(accountDir)
    expect(args[0]).toBe('--settings')
    expect(args[1]).toContain('memory-settings.json')
  })

  it('is idempotent — provisioning twice does not duplicate or error', () => {
    provisionClaudeAccount(accountDir, paths, true)
    provisionClaudeAccount(accountDir, paths, true)
    expect(isClaudeAccountProvisioned(accountDir)).toBe(true)
    const claudeJsonPath = join(accountDir, '.claude.json')
    const parsed = JSON.parse(readFileSync(claudeJsonPath, 'utf8'))
    expect(Object.keys(parsed.mcpServers)).toEqual(['nest_memory'])
  })

  it('deprovision removes mcpServers.nest_memory and deletes .nest/, preserving other mcpServers', () => {
    provisionClaudeAccount(accountDir, paths, true)
    const claudeJsonPath = join(accountDir, '.claude.json')
    const before = JSON.parse(readFileSync(claudeJsonPath, 'utf8'))
    before.mcpServers.other_server = { command: 'foo' }
    writeFileSync(claudeJsonPath, JSON.stringify(before, null, 2))

    deprovisionClaudeAccount(accountDir)

    expect(isClaudeAccountProvisioned(accountDir)).toBe(false)
    expect(existsSync(join(accountDir, '.nest'))).toBe(false)
    const after = JSON.parse(readFileSync(claudeJsonPath, 'utf8'))
    expect(after.mcpServers.nest_memory).toBeUndefined()
    expect(after.mcpServers.other_server).toEqual({ command: 'foo' })
  })

  it('respects an existing .claude.json with unrelated content', () => {
    writeFileSync(join(accountDir, '.claude.json'), JSON.stringify({ someOtherKey: 42, mcpServers: { foo: { command: 'bar' } } }))
    provisionClaudeAccount(accountDir, paths, true)
    const parsed = JSON.parse(readFileSync(join(accountDir, '.claude.json'), 'utf8'))
    expect(parsed.someOtherKey).toBe(42)
    expect(parsed.mcpServers.foo).toEqual({ command: 'bar' })
    expect(parsed.mcpServers.nest_memory).toBeDefined()
  })

  it('directory listing shows only Nest-owned files under .nest/', () => {
    provisionClaudeAccount(accountDir, paths, true)
    const files = readdirSync(join(accountDir, '.nest')).sort()
    expect(files).toEqual(['memory-settings.json', 'nest-memory.cmd'])
  })
})
