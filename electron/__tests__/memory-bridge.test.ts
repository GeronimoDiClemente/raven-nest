import { describe, it, expect } from 'vitest'
import { bridgeEvent, type BridgeContext } from '../integrations/memory-bridge'
import { defaultGraphTemplates } from '../integrations/graph-template'
import type { GraphRun, NodeRuntime } from '../integrations/graph-runner'

const full = defaultGraphTemplates().find((t) => t.id === 'full')!

const mkRun = (nodes: Record<string, NodeRuntime>): GraphRun => ({
  runId: 'r1', ticketId: 't-42', templateId: 'full', worktreePath: '/w', repoPath: '/repo',
  branch: 'feat/x', nodes, startedAt: 0, mode: 'auto', round: 0,
})

const ctxFor = (run: GraphRun): BridgeContext => ({
  getRun: () => run,
  getTemplate: () => full,
})

describe('bridgeEvent · gate_blocked', () => {
  it('emits one memory per blocking concern, not one per gate', () => {
    const run = mkRun({
      'rev-security': { state: 'done', verdict: { blocking: true, concerns: ['token logueado en claro', 'falta rate limit'] } },
    })
    const out = bridgeEvent(
      { type: 'graph.gate_blocked', ticketId: 't-42', gateId: 'gate', blockedBy: ['rev-security'] },
      ctxFor(run)
    )
    expect(out).toHaveLength(2)
    expect(out[0].title).toContain('token logueado en claro')
    expect(out[0].sourceRef).toBe('graph:r1:rev-security:0')
    expect(out[1].sourceRef).toBe('graph:r1:rev-security:1')
    expect(out[0].cwd).toBe('/repo')
    expect(out[0].gitBranch).toBe('feat/x')
    expect(out[0].content).toContain('[[run-r1]]')
    expect(out[0].tags).toContain('security')
  })

  it('uses bugfix for correctness-flavoured focus and discovery otherwise', () => {
    const run = mkRun({
      'rev-security': { state: 'done', verdict: { blocking: true, concerns: ['x'] } },
      'rev-perf': { state: 'done', verdict: { blocking: true, concerns: ['y'] } },
    })
    const sec = bridgeEvent({ type: 'graph.gate_blocked', ticketId: 't-42', gateId: 'gate', blockedBy: ['rev-security'] }, ctxFor(run))
    const perf = bridgeEvent({ type: 'graph.gate_blocked', ticketId: 't-42', gateId: 'gate', blockedBy: ['rev-perf'] }, ctxFor(run))
    expect(sec[0].type).toBe('bugfix')
    expect(perf[0].type).toBe('discovery')
  })

  it('produces nothing when the reviewer has no parsed verdict', () => {
    const run = mkRun({ 'rev-security': { state: 'done' } })
    const out = bridgeEvent({ type: 'graph.gate_blocked', ticketId: 't-42', gateId: 'gate', blockedBy: ['rev-security'] }, ctxFor(run))
    expect(out).toEqual([])
  })

  it('produces nothing when the run is unknown', () => {
    const out = bridgeEvent(
      { type: 'graph.gate_blocked', ticketId: 'nope', gateId: 'gate', blockedBy: ['rev-security'] },
      { getRun: () => null, getTemplate: () => full }
    )
    expect(out).toEqual([])
  })
})

describe('bridgeEvent · escalated', () => {
  it('records the rounds and what each revision asked for', () => {
    const run = mkRun({ coder: { state: 'done' } })
    run.round = 3
    run.revisionNotes = { coder: 'el fix no cubre el caso de token vacio' }
    const out = bridgeEvent(
      { type: 'graph.escalated', ticketId: 't-42', gateId: 'gate', round: 3 },
      ctxFor(run)
    )
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('discovery')
    expect(out[0].sourceRef).toBe('graph:r1:escalated')
    expect(out[0].title).toContain('3')
    expect(out[0].content).toContain('el fix no cubre el caso de token vacio')
    expect(out[0].content).toContain('[[run-r1]]')
  })
})

describe('bridgeEvent · descartes', () => {
  it('ignores transient and milestone-only events', () => {
    const run = mkRun({})
    const ctx = ctxFor(run)
    expect(bridgeEvent({ type: 'graph.node_started', ticketId: 't-42', nodeId: 'coder', role: 'coder' }, ctx)).toEqual([])
    expect(bridgeEvent({ type: 'graph.node_needs_input', ticketId: 't-42', nodeId: 'coder', role: 'coder' }, ctx)).toEqual([])
    expect(bridgeEvent({ type: 'pr.opened', branch: 'feat/x', repoFullName: 'o/r' }, ctx)).toEqual([])
    expect(bridgeEvent({ type: 'session.opened', branch: 'feat/x', repoPath: '/repo' }, ctx)).toEqual([])
    expect(bridgeEvent({ type: 'block.started', label: 'focus' }, ctx)).toEqual([])
    expect(bridgeEvent({ type: 'review.requested', repoFullName: 'o/r', prNumber: 1, prTitle: 'x' }, ctx)).toEqual([])
    expect(bridgeEvent({ type: 'task.created', taskId: 'x', pluginId: 'p', providerId: 'q', repoFullName: 'o/r', branch: 'b' }, ctx)).toEqual([])
  })
})
