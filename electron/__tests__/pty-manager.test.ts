import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'

// node-pty is a native module; stub it so this test exercises PtyManager's own logic
// (env construction, launchCmd quoting, the memory-provisioning integration point)
// without spawning a real OS process or waiting on a real shell.
const spawnMock = vi.fn()
vi.mock('node-pty', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

import { PtyManager, parseAccountDir, quoteShellArg, type PtyMemoryIntegration } from '../pty-manager'

function fakePty() {
  const listeners: Record<string, (...args: unknown[]) => void> = {}
  return {
    pid: 1234,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (cb: (...args: unknown[]) => void) => { listeners.data = cb },
    onExit: (cb: (...args: unknown[]) => void) => { listeners.exit = cb },
    __listeners: listeners,
  }
}

describe('parseAccountDir', () => {
  it('extracts aiType and accountName from a standard accountDir', () => {
    const dir = join('C:', 'Users', 'bauti', '.raven-nest', 'accounts', 'claude', 'Bautista')
    expect(parseAccountDir(dir)).toEqual({ aiType: 'claude', accountName: 'Bautista' })
  })

  it('returns null for a path with no "accounts" segment', () => {
    expect(parseAccountDir('/some/random/path')).toBeNull()
  })
})

describe('quoteShellArg', () => {
  it('wraps a plain value in double quotes', () => {
    expect(quoteShellArg('C:\\path\\file.json', true)).toBe('"C:\\path\\file.json"')
  })

  it('escapes an embedded double quote for PowerShell by doubling it', () => {
    expect(quoteShellArg('C:\\weird "name"\\file.json', true)).toBe('"C:\\weird ""name""\\file.json"')
  })

  it('escapes an embedded double quote for POSIX shells with a backslash', () => {
    expect(quoteShellArg('/weird "name"/file.json', false)).toBe('"/weird \\"name\\"/file.json"')
  })
})

describe('PtyManager — Nest Memory integration point (M11)', () => {
  let dir: string
  let manager: PtyManager

  beforeEach(() => {
    dir = makeTmpDir('raven-pty-')
    spawnMock.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanupTmp(dir)
  })

  function memoryIntegration(overrides: Partial<PtyMemoryIntegration> = {}): PtyMemoryIntegration {
    return {
      socketPath: '\\\\.\\pipe\\nest-memory-test',
      authToken: 'test-token-value',
      isEnabled: () => true,
      ensureClaudeProvisioned: vi.fn(() => ['--settings', join(dir, '.nest', 'memory-settings.json')]),
      ...overrides,
    }
  }

  it('calls ensureClaudeProvisioned (not just a read-only check) on every claude pane spawn', () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const integration = memoryIntegration()
    manager = new PtyManager(integration)

    const accountDir = join(dir, 'accounts', 'claude', 'Bautista')
    manager.create('pane-1', 'claude', accountDir, dir)

    expect(integration.ensureClaudeProvisioned).toHaveBeenCalledWith(accountDir)
  })

  it('injects NEST_MEMORY_SOCKET, NEST_MEMORY_TOKEN and NEST_MEMORY_ACCOUNT into the spawned env', () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const integration = memoryIntegration()
    manager = new PtyManager(integration)

    const accountDir = join(dir, 'accounts', 'claude', 'Bautista')
    manager.create('pane-1', 'claude', accountDir, dir)

    const spawnEnv = spawnMock.mock.calls[0][2].env
    expect(spawnEnv.NEST_MEMORY_SOCKET).toBe(integration.socketPath)
    expect(spawnEnv.NEST_MEMORY_TOKEN).toBe('test-token-value')
    expect(spawnEnv.NEST_MEMORY_ACCOUNT).toBe('claude:Bautista')
    expect(spawnEnv.NEST_MEMORY_ENABLED).toBe('1')
  })

  it('appends a properly quoted --settings flag to the launched claude command', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const settingsPath = join(dir, '.nest', 'memory-settings.json')
    const integration = memoryIntegration({ ensureClaudeProvisioned: vi.fn(() => ['--settings', settingsPath]) })
    manager = new PtyManager(integration)

    const accountDir = join(dir, 'accounts', 'claude', 'Bautista')
    manager.create('pane-1', 'claude', accountDir, dir)
    await vi.runAllTimersAsync()

    expect(fake.write).toHaveBeenCalledTimes(1)
    const written = fake.write.mock.calls[0][0] as string
    expect(written).toContain('claude --settings')
    expect(written).toContain(`"${settingsPath}"`)
  })

  it('does not inject memory env or provision when memory is disabled', () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const integration = memoryIntegration({ isEnabled: () => false })
    manager = new PtyManager(integration)

    const accountDir = join(dir, 'accounts', 'claude', 'Bautista')
    manager.create('pane-1', 'claude', accountDir, dir)

    expect(integration.ensureClaudeProvisioned).not.toHaveBeenCalled()
    const spawnEnv = spawnMock.mock.calls[0][2].env
    expect(spawnEnv.NEST_MEMORY_ENABLED).toBe('0')
  })

  it('does nothing memory-related for a plain terminal (no cmd)', () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const integration = memoryIntegration()
    manager = new PtyManager(integration)

    manager.create('pane-1', '', join(dir, 'accounts', 'claude', 'Bautista'), dir)

    expect(integration.ensureClaudeProvisioned).not.toHaveBeenCalled()
  })

  it('works with no memory integration configured at all (existing behavior unaffected)', () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    manager = new PtyManager() // no integration — matches every other existing PtyManager test

    expect(() => manager.create('pane-1', 'claude', join(dir, 'accounts', 'claude', 'Bautista'), dir)).not.toThrow()
  })
})
