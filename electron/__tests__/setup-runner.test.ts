import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTmpDir, cleanupTmp } from './setup'
import { SetupRunner } from '../setup-runner'

describe('SetupRunner', () => {
  let cwd: string
  let runner: SetupRunner

  beforeEach(() => {
    cwd = makeTmpDir('raven-setup-')
    runner = new SetupRunner()
  })

  afterEach(() => cleanupTmp(cwd))

  it('runs commands sequentially and resolves done', async () => {
    const echoCmd = process.platform === 'win32' ? 'echo hello' : 'echo hello'
    const result = await runner.run({
      worktreePath: cwd,
      presetId: 'p',
      commands: [echoCmd],
      env: {},
    })
    expect(result.state).toBe('done')
    expect(result.log).toContain('hello')
  })

  it('failed exit code → state failed and stops queue', async () => {
    const fail = process.platform === 'win32' ? 'cmd /c exit 1' : 'sh -c "exit 1"'
    const ok = process.platform === 'win32' ? 'echo SHOULD-NOT-RUN' : 'echo SHOULD-NOT-RUN'
    const result = await runner.run({
      worktreePath: cwd,
      presetId: 'p',
      commands: [fail, ok],
      env: {},
    })
    expect(result.state).toBe('failed')
    expect(result.log).not.toContain('SHOULD-NOT-RUN')
  })

  it('emits state and progress events', async () => {
    const states: string[] = []
    const lines: string[] = []
    runner.on('state', (_p, s) => states.push(s))
    runner.on('progress', (_p, l) => lines.push(l))
    await runner.run({
      worktreePath: cwd,
      presetId: 'p',
      commands: ['echo abc'],
      env: {},
    })
    expect(states[0]).toBe('running')
    expect(states[states.length - 1]).toBe('done')
    expect(lines.some((l) => l.includes('abc'))).toBe(true)
  })

  it('redacts secret-like values in log', async () => {
    const echo = process.platform === 'win32'
      ? 'echo TOKEN=abc123secret'
      : 'echo TOKEN=abc123secret'
    const result = await runner.run({
      worktreePath: cwd,
      presetId: 'p',
      commands: [echo],
      env: {},
    })
    expect(result.log).toContain('<redacted>')
    expect(result.log).not.toContain('abc123secret')
  })

  it('rejects double run on same worktree', async () => {
    const slow = process.platform === 'win32'
      ? 'ping -n 3 127.0.0.1'
      : 'sleep 1'
    const p = runner.run({ worktreePath: cwd, presetId: 'p', commands: [slow], env: {} })
    await expect(
      runner.run({ worktreePath: cwd, presetId: 'p', commands: ['echo'], env: {} })
    ).rejects.toThrow(/already running/)
    runner.cancel(cwd)
    await p
  })

  it('cancel() stops mid-run with state cancelled', async () => {
    const slow = process.platform === 'win32'
      ? 'ping -n 30 127.0.0.1'
      : 'sleep 30'
    const p = runner.run({ worktreePath: cwd, presetId: 'p', commands: [slow], env: {} })
    await new Promise((r) => setTimeout(r, 100))
    expect(runner.cancel(cwd)).toBe(true)
    const result = await p
    expect(result.state).toBe('cancelled')
  }, 10000)
})
