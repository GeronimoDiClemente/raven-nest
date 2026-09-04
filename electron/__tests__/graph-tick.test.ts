import { describe, it, expect } from 'vitest'
import { sampleGraph, launchCommand, type PaneSignals } from '../integrations/graph-tick'
import type { GraphRun } from '../integrations/graph-runner'

function run(nodes: GraphRun['nodes']): GraphRun {
  return { runId: 'r', ticketId: 't', templateId: 'full', worktreePath: '/w', branch: 'b', startedAt: 0, mode: 'auto', round: 0, nodes }
}

const alive: PaneSignals = { hasPty: true, lastOutputAt: 1000, cpuPercent: 50, bufferTail: '' }
const exited: PaneSignals = { hasPty: false, lastOutputAt: 1000, cpuPercent: 0, bufferTail: '' }

describe('sampleGraph', () => {
  it('samples only nodes that have a paneId', () => {
    const r = run({
      architect: { state: 'running', paneId: 'r:architect' },
      coder: { state: 'queued' }, // never launched, no paneId
    })
    const samples = sampleGraph(r, () => alive, 2000)
    expect(Object.keys(samples)).toEqual(['architect'])
    expect(samples.architect).toBe('working')
  })

  it('maps an exited pane to done (process gone)', () => {
    const r = run({ architect: { state: 'running', paneId: 'r:architect' } })
    const samples = sampleGraph(r, () => exited, 2000)
    expect(samples.architect).toBe('done')
  })

  it('skips a node whose pane the sampler cannot find (returns null)', () => {
    const r = run({ architect: { state: 'running', paneId: 'r:architect' } })
    const samples = sampleGraph(r, () => null, 2000)
    expect(samples).toEqual({})
  })

  it('passes the injected clock through to deriveAgentState', () => {
    const r = run({ architect: { state: 'running', paneId: 'r:architect' } })
    // lastOutputAt 1000, now 200000 → far past idle window → idle, not working
    const samples = sampleGraph(r, () => ({ ...alive, cpuPercent: 0 }), 200000)
    expect(samples.architect).toBe('idle')
  })
})

describe('launchCommand', () => {
  const posix = { promptPath: '/w/.nest/graph/coder.prompt', isWin: false }

  it('builds a headless claude command that reads the prompt from a file and exits', () => {
    // `-p` (print mode) + skip-permissions so the agent runs unattended; `exec`
    // replaces the shell so the pty closes with the CLI's exit code (→ 'done').
    expect(launchCommand({ agent: 'claude' }, posix)).toBe(
      `exec claude -p "$(cat '/w/.nest/graph/coder.prompt')" --dangerously-skip-permissions`,
    )
  })

  it('builds a headless codex command (exec subcommand + approvals bypass)', () => {
    expect(launchCommand({ agent: 'codex' }, posix)).toBe(
      `exec codex exec --dangerously-bypass-approvals-and-sandbox "$(cat '/w/.nest/graph/coder.prompt')"`,
    )
  })

  it('appends a safe --model flag', () => {
    expect(launchCommand({ agent: 'claude', model: 'opus' }, posix)).toBe(
      `exec claude -p "$(cat '/w/.nest/graph/coder.prompt')" --dangerously-skip-permissions --model opus`,
    )
  })

  it('drops an unsafe model (shell metacharacters) instead of injecting', () => {
    expect(launchCommand({ agent: 'claude', model: 'opus; rm -rf /' }, posix)).toBe(
      `exec claude -p "$(cat '/w/.nest/graph/coder.prompt')" --dangerously-skip-permissions`,
    )
  })

  it('single-quote-escapes the prompt path (defense in depth)', () => {
    expect(launchCommand({ agent: 'claude' }, { promptPath: "/w/a'b.prompt", isWin: false })).toBe(
      `exec claude -p "$(cat '/w/a'\\''b.prompt')" --dangerously-skip-permissions`,
    )
  })

  it('builds a PowerShell command that reads the prompt and exits with the CLI code', () => {
    expect(launchCommand({ agent: 'claude' }, { promptPath: 'C:\\w\\coder.prompt', isWin: true })).toBe(
      `& claude -p (Get-Content -Raw 'C:\\w\\coder.prompt') --dangerously-skip-permissions; exit $LASTEXITCODE`,
    )
  })

  it('returns empty for a missing/custom/headless-incapable agent (caller skips launch)', () => {
    expect(launchCommand({}, posix)).toBe('')
    expect(launchCommand({ agent: 'custom' }, posix)).toBe('')
    // gemini/copilot/opencode have no verified headless invocation yet → skipped.
    expect(launchCommand({ agent: 'gemini' }, posix)).toBe('')
  })
})
