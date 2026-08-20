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
  it('builds the CLI command for a known agent', () => {
    expect(launchCommand({ agent: 'claude' })).toBe('claude')
    expect(launchCommand({ agent: 'codex' })).toBe('codex')
  })

  it('appends a safe --model flag', () => {
    expect(launchCommand({ agent: 'claude', model: 'opus' })).toBe('claude --model opus')
  })

  it('drops an unsafe model (shell metacharacters) instead of injecting', () => {
    expect(launchCommand({ agent: 'claude', model: 'opus; rm -rf /' })).toBe('claude')
  })

  it('returns empty for a missing/custom agent (caller skips launch)', () => {
    expect(launchCommand({})).toBe('')
    expect(launchCommand({ agent: 'custom' })).toBe('')
  })
})
