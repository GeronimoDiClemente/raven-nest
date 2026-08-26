import { describe, it, expect } from 'vitest'
import { bridgeEvent, bridgeDecision, type BridgeContext } from '../integrations/memory-bridge'
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

  it('omits the "Revisiones pedidas" block when there are no revision notes', () => {
    const noNotes = mkRun({ coder: { state: 'done' } })
    noNotes.round = 2
    const withEmptyNotes = mkRun({ coder: { state: 'done' } })
    withEmptyNotes.round = 2
    withEmptyNotes.revisionNotes = {}

    for (const run of [noNotes, withEmptyNotes]) {
      const out = bridgeEvent(
        { type: 'graph.escalated', ticketId: 't-42', gateId: 'gate', round: 2 },
        ctxFor(run)
      )
      expect(out).toHaveLength(1)
      expect(out[0].content).not.toContain('Revisiones pedidas:')
    }
  })
})

describe('bridgeEvent · fallas duras', () => {
  it('traduce ci.failed usando su propio summary', () => {
    const out = bridgeEvent(
      { type: 'ci.failed', branch: 'feat/x', repoFullName: 'o/r', runUrl: 'https://ci/1', summary: '3 tests rojos en auth' },
      ctxFor(mkRun({}))
    )
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('bugfix')
    expect(out[0].content).toContain('3 tests rojos en auth')
    expect(out[0].content).toContain('https://ci/1')
    expect(out[0].sourceRef).toBe('ci:o/r:feat/x:https://ci/1')
    expect(out[0].gitBranch).toBe('feat/x')
  })

  it('no produce memoria si ci.failed no trae summary', () => {
    const out = bridgeEvent({ type: 'ci.failed', branch: 'feat/x', repoFullName: 'o/r' }, ctxFor(mkRun({})))
    expect(out).toEqual([])
  })

  it('traduce error.detected', () => {
    const out = bridgeEvent(
      { type: 'error.detected', source: 'sentry', ref: 'ISSUE-9', summary: 'null deref en UserList' },
      ctxFor(mkRun({}))
    )
    expect(out).toHaveLength(1)
    expect(out[0].sourceRef).toBe('error:sentry:ISSUE-9')
    expect(out[0].content).toContain('null deref en UserList')
  })
})

describe('bridgeDecision · approve', () => {
  it('records which concerns a human accepted anyway', () => {
    const run = mkRun({
      'rev-security': { state: 'done', verdict: { blocking: true, concerns: ['token logueado en claro'] } },
      'rev-perf': { state: 'done', verdict: { blocking: false, concerns: [] } },
    })
    const out = bridgeDecision({ kind: 'approve', gateId: 'gate' }, run, full)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('decision')
    expect(out[0].sourceRef).toBe('graph:r1:approve:gate:0')
    expect(out[0].content).toContain('token logueado en claro')
    expect(out[0].content).toContain('human-approved')
  })

  it('produces nothing when the gate had no blocking concerns to override', () => {
    const run = mkRun({ 'rev-security': { state: 'done', verdict: { blocking: false, concerns: [] } } })
    expect(bridgeDecision({ kind: 'approve', gateId: 'gate' }, run, full)).toEqual([])
  })

  it('keys by round so a re-approval after a reset does not overwrite the first one', () => {
    const run = mkRun({
      'rev-security': { state: 'done', verdict: { blocking: true, concerns: ['token logueado en claro'] } },
    })
    run.round = 0
    const firstPass = bridgeDecision({ kind: 'approve', gateId: 'gate' }, run, full)

    run.round = 1
    const secondPass = bridgeDecision({ kind: 'approve', gateId: 'gate' }, run, full)

    expect(firstPass).toHaveLength(1)
    expect(secondPass).toHaveLength(1)
    expect(firstPass[0].sourceRef).toBe('graph:r1:approve:gate:0')
    expect(secondPass[0].sourceRef).toBe('graph:r1:approve:gate:1')
    expect(firstPass[0].sourceRef).not.toBe(secondPass[0].sourceRef)
  })
})

describe('bridgeDecision · requestChanges', () => {
  it('keeps the human feedback verbatim and keys by round', () => {
    const run = mkRun({ coder: { state: 'done' } })
    run.round = 1
    const out = bridgeDecision({ kind: 'requestChanges', feedback: 'esto rompe el flujo de onboarding' }, run, full)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('decision')
    expect(out[0].sourceRef).toBe('graph:r1:changes:1')
    expect(out[0].content).toContain('esto rompe el flujo de onboarding')
    expect(out[0].content).toContain('human-rejected')
  })

  it('ignores empty feedback', () => {
    const run = mkRun({ coder: { state: 'done' } })
    expect(bridgeDecision({ kind: 'requestChanges', feedback: '   ' }, run, full)).toEqual([])
  })
})

describe('bridgeEvent · cierre de run', () => {
  it('resume el run: nodos hechos, concerns y rondas', () => {
    const run = mkRun({
      coder: { state: 'done' },
      'rev-security': { state: 'done', verdict: { blocking: true, concerns: ['token en claro'] } },
      tester: { state: 'done', exitCode: 0 },
    })
    run.round = 2
    const out = bridgeEvent({ type: 'graph.completed', ticketId: 't-42', templateId: 'full' }, ctxFor(run))
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('session')
    expect(out[0].sourceRef).toBe('graph:r1:run')
    expect(out[0].content).toContain('token en claro')
    expect(out[0].content).toContain('t-42')
    expect(out[0].content).toContain('[[run-r1]]')
  })

  it('pr.merged reusa la sourceRef del cierre para actualizar, no duplicar', () => {
    const run = mkRun({ coder: { state: 'done' } })
    const out = bridgeEvent({ type: 'pr.merged', branch: 'feat/x', repoFullName: 'o/r' }, {
      getRun: () => run,
      getTemplate: () => full,
    })
    expect(out).toHaveLength(1)
    expect(out[0].sourceRef).toBe('graph:r1:run')
    expect(out[0].content).toContain('Mergeado')
  })

  it('pr.merged sin run asociado no produce nada', () => {
    const out = bridgeEvent({ type: 'pr.merged', branch: 'feat/x', repoFullName: 'o/r' }, {
      getRun: () => null, getTemplate: () => full,
    })
    expect(out).toEqual([])
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
