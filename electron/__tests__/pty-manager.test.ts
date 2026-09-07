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

  // Mirrors what main.ts's real `ensureProvisioned` does — dispatch by `bin` through the
  // adapter registry (memory-cli-adapters.ts) — so these tests exercise PtyManager's own
  // logic (env building, quoting, launchCmd construction) exactly as production wires it:
  // a 'claude' bin gets the --settings flag, anything else is a no-op.
  function memoryIntegration(overrides: Partial<PtyMemoryIntegration> = {}): PtyMemoryIntegration {
    return {
      socketPath: '\\\\.\\pipe\\nest-memory-test',
      authToken: 'test-token-value',
      isEnabled: () => true,
      ensureProvisioned: vi.fn((bin: string) =>
        bin === 'claude'
          ? { args: ['--settings', join(dir, '.nest', 'memory-settings.json')], env: {} }
          : { args: [], env: {} }
      ),
      ...overrides,
    }
  }

  // NOTE: PtyManager.create() became async on main (the cwd-existence check switched
  // from sync existsSync to an async cwdReachable() with its own race/timeout — see
  // main's pty-manager.ts). ensureProvisioned and every NEST_MEMORY_* env write
  // still happen synchronously BEFORE that first `await`, but pty.spawn() itself now
  // only runs after it resolves — so any assertion touching spawnMock must await the
  // full create() call first (fake timers alone aren't enough: cwdReachable's happy
  // path resolves via real fs.promises.stat, not a timer).

  it('calls ensureProvisioned (not just a read-only check) on every claude pane spawn', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const integration = memoryIntegration()
    manager = new PtyManager(integration)

    const accountDir = join(dir, 'accounts', 'claude', 'Bautista')
    await manager.create('pane-1', 'claude', accountDir, dir)

    expect(integration.ensureProvisioned).toHaveBeenCalledWith('claude', accountDir)
  })

  it('injects NEST_MEMORY_SOCKET, NEST_MEMORY_TOKEN and NEST_MEMORY_ACCOUNT into the spawned env', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const integration = memoryIntegration()
    manager = new PtyManager(integration)

    const accountDir = join(dir, 'accounts', 'claude', 'Bautista')
    await manager.create('pane-1', 'claude', accountDir, dir)

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
    const integration = memoryIntegration({ ensureProvisioned: vi.fn(() => ({ args: ['--settings', settingsPath], env: {} })) })
    manager = new PtyManager(integration)

    const accountDir = join(dir, 'accounts', 'claude', 'Bautista')
    await manager.create('pane-1', 'claude', accountDir, dir)
    await vi.runAllTimersAsync()

    expect(fake.write).toHaveBeenCalledTimes(1)
    const written = fake.write.mock.calls[0][0] as string
    expect(written).toContain('claude --settings')
    expect(written).toContain(`"${settingsPath}"`)
  })

  it('does not inject memory env or provision when memory is disabled', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const integration = memoryIntegration({ isEnabled: () => false })
    manager = new PtyManager(integration)

    const accountDir = join(dir, 'accounts', 'claude', 'Bautista')
    await manager.create('pane-1', 'claude', accountDir, dir)

    expect(integration.ensureProvisioned).not.toHaveBeenCalled()
    const spawnEnv = spawnMock.mock.calls[0][2].env
    expect(spawnEnv.NEST_MEMORY_ENABLED).toBe('0')
  })

  it('does nothing memory-related for a plain terminal (no cmd)', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const integration = memoryIntegration()
    manager = new PtyManager(integration)

    await manager.create('pane-1', '', join(dir, 'accounts', 'claude', 'Bautista'), dir)

    expect(integration.ensureProvisioned).not.toHaveBeenCalled()
  })

  it('works with no memory integration configured at all (existing behavior unaffected)', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    manager = new PtyManager() // no integration — matches every other existing PtyManager test

    const result = await manager.create('pane-1', 'claude', join(dir, 'accounts', 'claude', 'Bautista'), dir)
    expect(result.ok).toBe(true)
  })

  // ---- Bug 3.1 (MEMORY_INTEGRATIONS_CONTRACT §3) ----
  // `cmd === 'claude'` was an exact comparison, but the graph orchestrator launches
  // nodes via launchCommand(), which returns `claude --model <x>` whenever the node
  // has a model assigned. That case silently missed the whole memory branch: no
  // --settings flag, no hooks, no memory — and only for nodes WITH a model, so it
  // failed intermittently.
  it('provisions and injects the --settings flag when the claude command carries its own args', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const settingsPath = join(dir, '.nest', 'memory-settings.json')
    const integration = memoryIntegration({ ensureProvisioned: vi.fn(() => ({ args: ['--settings', settingsPath], env: {} })) })
    manager = new PtyManager(integration)

    const accountDir = join(dir, 'accounts', 'claude', 'Bautista')
    await manager.create('pane-1', 'claude --model claude-opus-5', accountDir, dir)
    await vi.runAllTimersAsync()

    expect(integration.ensureProvisioned).toHaveBeenCalledWith('claude', accountDir)
    const written = fake.write.mock.calls[0][0] as string
    expect(written).toContain(`claude --settings "${settingsPath}"`)
    // the caller's own args must survive — the old code rebuilt the command from
    // scratch as `claude ${flags}` and would have dropped --model entirely
    expect(written).toContain('--model claude-opus-5')
  })

  it('leaves a non-claude command untouched even though its first token differs', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const integration = memoryIntegration()
    manager = new PtyManager(integration)

    const accountDir = join(dir, 'accounts', 'codex', 'Bautista')
    await manager.create('pane-1', 'codex --model gpt-5', accountDir, dir)
    await vi.runAllTimersAsync()

    // ensureProvisioned is called generically for every bin (dispatch by adapter lives
    // in the integration, e.g. main.ts's adapterForBin) — but with no adapter for
    // 'codex' it comes back as a no-op, so launchCmd is untouched, same as before.
    expect(integration.ensureProvisioned).toHaveBeenCalledWith('codex', accountDir)
    expect(fake.write.mock.calls[0][0]).toBe('codex --model gpt-5\r')
  })

  // ---- Bug 3.2 (MEMORY_INTEGRATIONS_CONTRACT §3) ----
  // The whole memory block lived inside `if (accountDir && cmd)`. A headless graph
  // node whose agent has no saved account gets accountDir '' from
  // accountDirForAgent() and runs with the REAL HOME — so it fell out of memory
  // entirely. Memory must not depend on the HOME redirection.
  describe('headless pane with no account dir (real HOME)', () => {
    const realHome = process.env.HOME
    // ravenHome() reads RAVEN_HOME on every call, so pointing it at the tmp dir keeps
    // the headless provisioning target out of the developer's real ~/.raven-nest.
    const prevRavenHome = process.env.RAVEN_HOME

    beforeEach(() => { process.env.RAVEN_HOME = dir })
    afterEach(() => {
      if (prevRavenHome === undefined) delete process.env.RAVEN_HOME
      else process.env.RAVEN_HOME = prevRavenHome
    })

    it('still injects the NEST_MEMORY_* env', async () => {
      const fake = fakePty()
      spawnMock.mockReturnValue(fake)
      const integration = memoryIntegration()
      manager = new PtyManager(integration)

      await manager.create('pane-1', 'claude --model claude-opus-5', '', dir)

      const spawnEnv = spawnMock.mock.calls[0][2].env
      expect(spawnEnv.NEST_MEMORY_SOCKET).toBe(integration.socketPath)
      expect(spawnEnv.NEST_MEMORY_TOKEN).toBe('test-token-value')
      expect(spawnEnv.NEST_MEMORY_ENABLED).toBe('1')
      expect(spawnEnv.NEST_MEMORY_AI).toBe('claude')
      expect(spawnEnv.NEST_MEMORY_ACCOUNT).toBe('claude:__headless__')
    })

    it('does not redirect HOME — the node keeps the real one for its credentials', async () => {
      const fake = fakePty()
      spawnMock.mockReturnValue(fake)
      manager = new PtyManager(memoryIntegration())

      await manager.create('pane-1', 'claude', '', dir)

      expect(spawnMock.mock.calls[0][2].env.HOME).toBe(realHome)
    })

    it('provisions into a Nest-owned headless dir instead of the real home', async () => {
      const fake = fakePty()
      spawnMock.mockReturnValue(fake)
      const integration = memoryIntegration()
      manager = new PtyManager(integration)

      await manager.create('pane-1', 'claude', '', dir)

      const target = (integration.ensureProvisioned as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      expect(target).toBe(join(dir, '.raven-nest', 'accounts', 'claude', '__headless__'))
      expect(target.startsWith(realHome as string)).toBe(false)
    })

    it('passes --mcp-config too, because with a real HOME claude never reads the headless .claude.json', async () => {
      const fake = fakePty()
      spawnMock.mockReturnValue(fake)
      const headlessDir = join(dir, '.raven-nest', 'accounts', 'claude', '__headless__')
      const settingsPath = join(headlessDir, '.nest', 'memory-settings.json')
      const integration = memoryIntegration({ ensureProvisioned: vi.fn(() => ({ args: ['--settings', settingsPath], env: {} })) })
      manager = new PtyManager(integration)

      await manager.create('pane-1', 'claude', '', dir)
      await vi.runAllTimersAsync()

      const written = fake.write.mock.calls[0][0] as string
      expect(written).toContain(`--settings "${settingsPath}"`)
      expect(written).toContain(`--mcp-config "${join(headlessDir, '.claude.json')}"`)
    })

    it('does not pass --mcp-config for a normal account pane, where HOME already points at it', async () => {
      const fake = fakePty()
      spawnMock.mockReturnValue(fake)
      manager = new PtyManager(memoryIntegration())

      await manager.create('pane-1', 'claude', join(dir, 'accounts', 'claude', 'Bautista'), dir)
      await vi.runAllTimersAsync()

      expect(fake.write.mock.calls[0][0]).not.toContain('--mcp-config')
    })
  })
})
