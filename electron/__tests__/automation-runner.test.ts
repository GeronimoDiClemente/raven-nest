import { describe, it, expect, vi } from 'vitest'
import {
  buildAgentArgv,
  summarize,
  makeRunAutomation,
  type AutomationRunnerPorts,
} from '../integrations/automation-runner'
import type { Automation } from '../integrations/scheduler'

function makeAutomation(over: Partial<Automation> = {}): Automation {
  return {
    id: 'a1',
    name: 'Nightly audit',
    trigger: 'daily',
    time: '18:00',
    prompt: 'Audit the repo for security issues and summarize.',
    provider: 'claude',
    repo: '/repos/widgets',
    enabled: true,
    createdAt: Date.parse('2026-01-01T00:00:00'),
    updatedAt: Date.parse('2026-01-01T00:00:00'),
    ...over,
  }
}

/** Ports whose fakes record the call order into a shared log, so tests can
 *  assert create → runAgent → remove without coupling to timing. */
function makePorts(over: Partial<AutomationRunnerPorts> = {}): {
  ports: AutomationRunnerPorts
  order: string[]
  fakes: {
    createWorktree: ReturnType<typeof vi.fn>
    runAgent: ReturnType<typeof vi.fn>
    removeWorktree: ReturnType<typeof vi.fn>
    resolveModel: ReturnType<typeof vi.fn>
    makeId: ReturnType<typeof vi.fn>
  }
} {
  const order: string[] = []
  const createWorktree = vi.fn(async (_repo: string, _branch: string) => {
    order.push('create')
    return { ok: true as const, wtPath: '/tmp/wt-xyz' }
  })
  const runAgent = vi.fn(async (_argv: string[], _cwd: string) => {
    order.push('runAgent')
    return { ok: true, output: 'line1\nline2\nall good' }
  })
  const removeWorktree = vi.fn(async (_repo: string, _wtPath: string) => {
    order.push('remove')
  })
  const resolveModel = vi.fn((_a: Automation) => undefined as string | undefined)
  const makeId = vi.fn(() => 'ID123')
  const ports: AutomationRunnerPorts = {
    createWorktree,
    runAgent,
    removeWorktree,
    resolveModel,
    makeId,
    ...over,
  }
  // `fakes` mirrors the *effective* ports (after overrides) so assertions
  // target whatever fn actually ran, not the shadowed default.
  return {
    ports,
    order,
    fakes: {
      createWorktree: ports.createWorktree as ReturnType<typeof vi.fn>,
      runAgent: ports.runAgent as ReturnType<typeof vi.fn>,
      removeWorktree: ports.removeWorktree as ReturnType<typeof vi.fn>,
      resolveModel: ports.resolveModel as ReturnType<typeof vi.fn>,
      makeId: ports.makeId as ReturnType<typeof vi.fn>,
    },
  }
}

const NOW = new Date(2026, 0, 5, 18, 0, 0, 0)

describe('buildAgentArgv', () => {
  it('claude, no model → ["claude", "-p", prompt]', () => {
    expect(buildAgentArgv('claude', 'hello world')).toEqual(['claude', '-p', 'hello world'])
  })

  it('claude with a valid model → inserts --model before -p', () => {
    expect(buildAgentArgv('claude', 'hi', 'opus')).toEqual(['claude', '--model', 'opus', '-p', 'hi'])
  })

  it('drops an unsafe model (fails the safe-char regex) rather than passing it through', () => {
    expect(buildAgentArgv('claude', 'hi', 'bad model!')).toEqual(['claude', '-p', 'hi'])
  })

  it('keeps models with the allowed punctuation (. _ : / -)', () => {
    expect(buildAgentArgv('claude', 'hi', 'claude-opus-4.8:1m/beta')).toEqual([
      'claude', '--model', 'claude-opus-4.8:1m/beta', '-p', 'hi',
    ])
  })

  it.each(['codex', 'gemini', 'copilot', 'opencode', 'terminal', 'custom', undefined])(
    'returns null for provider %s (no confirmed headless mode)',
    (provider) => {
      expect(buildAgentArgv(provider, 'hi')).toBeNull()
    },
  )

  it('never concatenates or splits the prompt — it is always exactly one array element, intact', () => {
    const nasty = 'audit; rm -rf $(pwd)'
    const argv = buildAgentArgv('claude', nasty)
    expect(argv).not.toBeNull()
    // The prompt survives as a single, byte-identical element (no shell parsing here).
    expect(argv).toContain(nasty)
    expect(argv!.filter((x) => x === nasty)).toHaveLength(1)
    expect(argv).toEqual(['claude', '-p', nasty])
  })
})

describe('summarize', () => {
  it('empty output → empty string', () => {
    expect(summarize('')).toBe('')
  })

  it('whitespace-only output → empty string', () => {
    expect(summarize('   \n\n\t  \n')).toBe('')
  })

  it('keeps only the last N non-empty lines (default 8)', () => {
    const output = Array.from({ length: 12 }, (_, i) => `line${i + 1}`).join('\n')
    expect(summarize(output)).toBe(['line5', 'line6', 'line7', 'line8', 'line9', 'line10', 'line11', 'line12'].join('\n'))
  })

  it('ignores blank lines when picking the last N', () => {
    expect(summarize('a\n\n\nb\n\n')).toBe('a\nb')
  })

  it('respects a custom maxLines', () => {
    const output = 'a\nb\nc\nd'
    expect(summarize(output, 2)).toBe('c\nd')
  })

  it('caps the result to maxChars, truncating with an ellipsis', () => {
    const longLine = 'a'.repeat(700)
    const out = summarize(longLine) // default maxChars = 600
    expect(out.length).toBe(600)
    expect(out.endsWith('…')).toBe(true)
  })

  it('respects a custom maxChars', () => {
    const out = summarize('abcdefghij', 8, 5)
    expect(out.length).toBe(5)
    expect(out.endsWith('…')).toBe(true)
    expect(out).toBe('abcd…')
  })

  it('does not truncate when already within maxChars', () => {
    expect(summarize('short', 8, 600)).toBe('short')
  })
})

describe('makeRunAutomation', () => {
  it('happy path: create → runAgent → remove, in that order, returns ok + summarized output', async () => {
    const { ports, order, fakes } = makePorts()
    const run = makeRunAutomation(ports)
    const automation = makeAutomation({ id: 'a1', provider: 'claude', repo: '/repos/widgets' })

    const result = await run(automation, NOW)

    expect(result).toEqual({ ok: true, summary: summarize('line1\nline2\nall good') })

    // createWorktree got (repo, branch) with a branch tied to the automation id + makeId().
    expect(fakes.createWorktree).toHaveBeenCalledTimes(1)
    const [repoArg, branchArg] = fakes.createWorktree.mock.calls[0]
    expect(repoArg).toBe('/repos/widgets')
    expect(branchArg).toContain('a1')
    expect(branchArg).toContain('ID123')
    expect(fakes.makeId).toHaveBeenCalled()

    // runAgent got the buildAgentArgv output and the created worktree path.
    expect(fakes.runAgent).toHaveBeenCalledTimes(1)
    const [argvArg, cwdArg] = fakes.runAgent.mock.calls[0]
    expect(argvArg).toEqual(buildAgentArgv('claude', automation.prompt))
    expect(cwdArg).toBe('/tmp/wt-xyz')

    // cleanup ran with (repo, wtPath).
    expect(fakes.removeWorktree).toHaveBeenCalledTimes(1)
    expect(fakes.removeWorktree).toHaveBeenCalledWith('/repos/widgets', '/tmp/wt-xyz')

    expect(order).toEqual(['create', 'runAgent', 'remove'])
  })

  it('runAgent {ok:false} → result ok:false, cleanup still runs (finally)', async () => {
    const runAgent = vi.fn(async () => ({ ok: false, output: 'boom\nCLI exited 1' }))
    const { ports, fakes } = makePorts({ runAgent })
    const run = makeRunAutomation(ports)

    const result = await run(makeAutomation(), NOW)

    expect(result.ok).toBe(false)
    expect(result.summary).toBe(summarize('boom\nCLI exited 1'))
    expect(fakes.removeWorktree).toHaveBeenCalledTimes(1)
  })

  it('runAgent throws → captured (not propagated), result ok:false with the error message, cleanup still runs', async () => {
    const runAgent = vi.fn(async () => { throw new Error('agent crashed') })
    const { ports, fakes } = makePorts({ runAgent })
    const run = makeRunAutomation(ports)

    const result = await run(makeAutomation(), NOW)

    expect(result.ok).toBe(false)
    expect(result.summary).toContain('agent crashed')
    expect(fakes.removeWorktree).toHaveBeenCalledTimes(1)
  })

  it('unsupported provider → ok:false mentioning the provider, createWorktree never called', async () => {
    const { ports, fakes } = makePorts()
    const run = makeRunAutomation(ports)

    const result = await run(makeAutomation({ provider: 'codex' }), NOW)

    expect(result.ok).toBe(false)
    expect(result.summary).toContain('codex')
    expect(fakes.createWorktree).not.toHaveBeenCalled()
    expect(fakes.runAgent).not.toHaveBeenCalled()
    expect(fakes.removeWorktree).not.toHaveBeenCalled()
  })

  it('missing repo → ok:false mentioning the missing repo, createWorktree never called', async () => {
    const { ports, fakes } = makePorts()
    const run = makeRunAutomation(ports)

    const result = await run(makeAutomation({ repo: undefined }), NOW)

    expect(result.ok).toBe(false)
    expect((result.summary ?? '').toLowerCase()).toContain('repo')
    expect(fakes.createWorktree).not.toHaveBeenCalled()
    expect(fakes.runAgent).not.toHaveBeenCalled()
    expect(fakes.removeWorktree).not.toHaveBeenCalled()
  })

  it('createWorktree failure → ok:false with the error, runAgent and removeWorktree never called', async () => {
    const createWorktree = vi.fn(async () => ({ ok: false as const, error: 'branch already exists' }))
    const { ports, fakes } = makePorts({ createWorktree })
    const run = makeRunAutomation(ports)

    const result = await run(makeAutomation(), NOW)

    expect(result.ok).toBe(false)
    expect(result.summary).toContain('branch already exists')
    expect(fakes.runAgent).not.toHaveBeenCalled()
    expect(fakes.removeWorktree).not.toHaveBeenCalled()
  })

  it('resolves the model via resolveModel and threads it into the agent argv', async () => {
    const resolveModel = vi.fn(() => 'sonnet')
    const { ports, fakes } = makePorts({ resolveModel })
    const run = makeRunAutomation(ports)
    const automation = makeAutomation()

    await run(automation, NOW)

    expect(fakes.resolveModel).toHaveBeenCalledWith(automation)
    const [argvArg] = fakes.runAgent.mock.calls[0]
    expect(argvArg).toEqual(['claude', '--model', 'sonnet', '-p', automation.prompt])
  })
})
