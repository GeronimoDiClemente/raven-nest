import { describe, it, expect } from 'vitest'
import { defaultGraphTemplates } from '../integrations/graph-template'
import { mapAgentState, syncNodeStates, planTick, dedupePersistentSignals } from '../integrations/graph-orchestrator'
import type { GraphTemplate } from '../integrations/graph-template'
import type { GraphRun, NodeRuntime } from '../integrations/graph-runner'
import type { DomainEvent } from '../integrations/bus-types'

const full = defaultGraphTemplates().find((t) => t.id === 'full')!

const base = { runId: 'r1', ticketId: 't1', templateId: 'full', worktreePath: '/w', branch: 'b', startedAt: 0, mode: 'auto' as const, round: 0 }
const mkRun = (nodes: Record<string, NodeRuntime>): GraphRun => ({ ...base, nodes })
const withStates = (m: Record<string, NodeRuntime['state']>): GraphRun =>
  mkRun(Object.fromEntries(full.nodes.map((n) => [n.id, { state: m[n.id] ?? 'queued' }])))
const noArtifacts = () => null

// 2-node-plus-gate template used by the eval-loop tests: coder → rev (reviewer) → gate.
const reviewTemplate: GraphTemplate = {
  id: 'review', name: 'review', nodes: [
    { id: 'coder', role: 'coder', kind: 'agent', agent: 'claude', dependsOn: [] },
    { id: 'rev', role: 'reviewer', kind: 'agent', agent: 'claude', dependsOn: ['coder'] },
    { id: 'gate', role: 'gate', kind: 'gate', dependsOn: ['rev'] },
  ], createdAt: 0, updatedAt: 0,
}
const makeReviewTemplate = (): GraphTemplate => reviewTemplate
const makeRun = (t: GraphTemplate, m: Record<string, Partial<NodeRuntime> & { state: NodeRuntime['state'] }>): GraphRun => ({
  ...base, templateId: t.id,
  nodes: Object.fromEntries(t.nodes.map((n) => [n.id, m[n.id] ?? { state: 'queued' }])),
})

describe('mapAgentState', () => {
  it('maps the 4 pane states to node run states', () => {
    expect(mapAgentState('working')).toBe('running')
    expect(mapAgentState('needs_input')).toBe('needs_input')
    expect(mapAgentState('idle')).toBe('running') // still alive; not finished
    expect(mapAgentState('done')).toBe('done')
  })
})

describe('syncNodeStates', () => {
  it('updates a live node and stamps endedAt when it finishes', () => {
    const run = mkRun({
      architect: { state: 'running', paneId: 'p1', startedAt: 5 },
      coder: { state: 'queued' },
    })
    const out = syncNodeStates(run, { architect: 'done' }, 100)
    expect(out.nodes.architect.state).toBe('done')
    expect(out.nodes.architect.endedAt).toBe(100)
    expect(out.nodes.coder.state).toBe('queued') // untouched
    // input not mutated
    expect(run.nodes.architect.state).toBe('running')
    expect(run.nodes.architect.endedAt).toBeUndefined()
  })

  it('keeps a still-working node running with no endedAt', () => {
    const run = mkRun({ architect: { state: 'running', paneId: 'p1' } })
    const out = syncNodeStates(run, { architect: 'working' }, 100)
    expect(out.nodes.architect.state).toBe('running')
    expect(out.nodes.architect.endedAt).toBeUndefined()
  })

  it('ignores samples for nodes already in a terminal state', () => {
    const run = mkRun({ architect: { state: 'done', endedAt: 9 } })
    const out = syncNodeStates(run, { architect: 'working' }, 100)
    expect(out.nodes.architect.state).toBe('done')
    expect(out.nodes.architect.endedAt).toBe(9)
  })
})

describe('planTick', () => {
  it('launches the root architect with a composed input and marks it running', () => {
    const run = withStates({})
    const plan = planTick(full, run, {}, { now: 10, maxReviewRounds: 2, readArtifact: noArtifacts })
    expect(plan.start.map((s) => s.nodeId)).toEqual(['architect'])
    const a = plan.start[0]
    expect(a.agent).toBe('claude')
    expect(a.paneId).toBe('r1:architect')
    // architect is non-leaf → its input tells it where to write its artifact
    expect(a.input).toContain('.nest/graph/architect.md')
    expect(plan.run.nodes.architect.state).toBe('running')
    expect(plan.run.nodes.architect.paneId).toBe('r1:architect')
    expect(plan.run.nodes.architect.startedAt).toBe(10)
    expect(plan.events.some((e) => e.type === 'graph.node_started')).toBe(true)
    // input run not mutated
    expect(run.nodes.architect.state).toBe('queued')
  })

  it('fans out to the 3 reviewers after the coder is done, each carrying the coder artifact', () => {
    const run = withStates({ architect: 'done', coder: 'done' })
    const plan = planTick(full, run, {}, {
      now: 20, maxReviewRounds: 2,
      readArtifact: (_wt, rel) => (rel.endsWith('coder.md') ? 'CODER DIFF' : null),
    })
    expect(plan.start.map((s) => s.nodeId).sort()).toEqual(['rev-perf', 'rev-security', 'rev-types'])
    for (const s of plan.start) expect(s.input).toContain('CODER DIFF')
  })

  it('resolves a passed gate to done without launching it as a pane', () => {
    const run = withStates({
      architect: 'done', coder: 'done',
      'rev-security': 'done', 'rev-types': 'done', 'rev-perf': 'done',
    })
    const plan = planTick(full, run, {}, { now: 30, maxReviewRounds: 2, readArtifact: noArtifacts })
    expect(plan.run.nodes.gate.state).toBe('done')
    expect(plan.start.map((s) => s.nodeId)).not.toContain('gate')
  })

  it('aggregates the 3 reviewer artifacts through the gate into the tester input', () => {
    const run = withStates({
      architect: 'done', coder: 'done',
      'rev-security': 'done', 'rev-types': 'done', 'rev-perf': 'done', gate: 'done',
    })
    const plan = planTick(full, run, {}, {
      now: 40, maxReviewRounds: 2,
      readArtifact: (_wt, rel) => (rel.includes('review-') ? `SEEN ${rel}` : null),
    })
    const tester = plan.start.find((s) => s.nodeId === 'tester')
    expect(tester).toBeTruthy()
    expect(tester!.input).toContain('review-security.json')
    expect(tester!.input).toContain('review-types.json')
    expect(tester!.input).toContain('review-performance.json')
  })

  it('skips descendants of a failed node', () => {
    const run = withStates({ architect: 'done', coder: 'failed' })
    const plan = planTick(full, run, {}, { now: 50, maxReviewRounds: 2, readArtifact: noArtifacts })
    for (const id of ['rev-security', 'rev-types', 'rev-perf', 'tester']) {
      expect(plan.run.nodes[id].state).toBe('skipped')
    }
  })

  it('emits node_done when a running pane has finished', () => {
    const run = mkRun({
      architect: { state: 'running', paneId: 'r1:architect', startedAt: 1 },
      coder: { state: 'queued' },
      'rev-security': { state: 'queued' }, 'rev-types': { state: 'queued' },
      'rev-perf': { state: 'queued' }, gate: { state: 'queued' }, tester: { state: 'queued' },
    })
    const plan = planTick(full, run, { architect: 'done' }, { now: 60, maxReviewRounds: 2, readArtifact: noArtifacts })
    expect(plan.events.some((e) => e.type === 'graph.node_done' && (e as { nodeId: string }).nodeId === 'architect')).toBe(true)
    // architect done → coder becomes ready and launches
    expect(plan.start.map((s) => s.nodeId)).toContain('coder')
  })

  it('reports completed when the tester is done', () => {
    const run = withStates(Object.fromEntries(full.nodes.map((n) => [n.id, 'done'])) as Record<string, NodeRuntime['state']>)
    const plan = planTick(full, run, {}, { now: 70, maxReviewRounds: 2, readArtifact: noArtifacts })
    expect(plan.completed).toBe(true)
    expect(plan.events.some((e) => e.type === 'graph.completed')).toBe(true)
  })

  it('a reviewer that finished with a blocking verdict becomes blocked, not done', () => {
    const t = makeReviewTemplate()
    const run = makeRun(t, { coder: { state: 'done' }, rev: { state: 'running', paneId: 'p:rev' } })
    run.mode = 'gate' // isolate the verdict pass from auto-repair (Task 7), which would
    // otherwise rewind this same-tick blocked gate immediately in 'auto' mode
    const plan = planTick(t, run, { rev: 'done' }, {
      now: 100, maxReviewRounds: 2,
      readArtifact: (_wt, rel) => rel.endsWith('review-rev.json')
        ? JSON.stringify({ concerns: ['double-charge'], blocking: true }) : null,
    })
    expect(plan.run.nodes.rev.state).toBe('blocked')
    expect(plan.run.nodes.rev.verdict).toEqual({ concerns: ['double-charge'], blocking: true })
  })

  it('a reviewer with a clean verdict stays done and carries concerns', () => {
    const t = makeReviewTemplate()
    const run = makeRun(t, { coder: { state: 'done' }, rev: { state: 'running', paneId: 'p:rev' } })
    const plan = planTick(t, run, { rev: 'done' }, {
      now: 100, maxReviewRounds: 2,
      readArtifact: () => JSON.stringify({ concerns: ['nit: rename'], blocking: false }),
    })
    expect(plan.run.nodes.rev.state).toBe('done')
    expect(plan.run.nodes.rev.verdict!.blocking).toBe(false)
  })

  it('a reviewer that finished with NO verdict is treated as blocked (conservative)', () => {
    const t = makeReviewTemplate()
    const run = makeRun(t, { coder: { state: 'done' }, rev: { state: 'running', paneId: 'p:rev' } })
    run.mode = 'gate' // isolate the verdict pass from auto-repair (Task 7)
    const plan = planTick(t, run, { rev: 'done' }, {
      now: 100, maxReviewRounds: 2, readArtifact: () => null,
    })
    expect(plan.run.nodes.rev.state).toBe('blocked')
    expect(plan.run.nodes.rev.verdict).toEqual({ concerns: ['reviewer produced no parseable verdict'], blocking: true })
  })

  it('applies a pending approve before advancing (gate resolves next)', () => {
    const t = makeReviewTemplate() // coder → rev → gate
    const run = makeRun(t, {
      coder: { state: 'done' }, rev: { state: 'blocked', verdict: { concerns: ['x'], blocking: true } },
      gate: { state: 'queued' },
    })
    run.pendingDecision = { kind: 'approve', gateId: 'gate' }
    const plan = planTick(t, run, {}, { now: 1, maxReviewRounds: 2, readArtifact: () => null })
    expect(plan.run.nodes.rev.state).toBe('done')
    expect(plan.run.pendingDecision).toBeUndefined()
  })

  it('mode "gate": a clean passed gate is NOT auto-resolved, it waits', () => {
    const t = makeReviewTemplate()
    const run = makeRun(t, { coder: { state: 'done' }, rev: { state: 'done' }, gate: { state: 'queued' } })
    run.mode = 'gate'
    const plan = planTick(t, run, {}, { now: 1, maxReviewRounds: 2, readArtifact: () => null })
    expect(plan.run.nodes.gate.state).toBe('queued')       // held, not done
    expect(plan.blockedOn).toContain('gate')
  })

  it('mode "auto": a clean passed gate auto-resolves to done', () => {
    const t = makeReviewTemplate()
    const run = makeRun(t, { coder: { state: 'done' }, rev: { state: 'done' }, gate: { state: 'queued' } })
    run.mode = 'auto'
    const plan = planTick(t, run, {}, { now: 1, maxReviewRounds: 2, readArtifact: () => null })
    expect(plan.run.nodes.gate.state).toBe('done')
  })

  it('relaunched coder gets its revisionNote in the composed input', () => {
    const t = makeReviewTemplate() // coder → rev → gate
    const run = makeRun(t, { coder: { state: 'queued' } })
    run.revisionNotes = { coder: 'scope key per attempt' }
    const plan = planTick(t, run, {}, { now: 1, maxReviewRounds: 2, readArtifact: () => null })
    const coderStart = plan.start.find(s => s.nodeId === 'coder')!
    expect(coderStart.input).toContain('Revision requested: scope key per attempt')
  })

  it('mode "auto": a blocked gate under the retry cap re-runs the coder (no gate_blocked)', () => {
    const t = makeReviewTemplate()
    const run = makeRun(t, {
      coder: { state: 'done' }, rev: { state: 'blocked', verdict: { concerns: ['x'], blocking: true } },
      gate: { state: 'queued' },
    })
    run.mode = 'auto'; run.round = 0
    const plan = planTick(t, run, {}, { now: 1, maxReviewRounds: 2, readArtifact: () => null })
    expect(plan.run.nodes.coder.state).toBe('queued')   // re-run triggered
    expect(plan.run.round).toBe(1)
    expect(plan.events.some(e => e.type === 'graph.gate_blocked')).toBe(false)
  })

  it('mode "auto": at the retry cap it escalates instead of re-running', () => {
    const t = makeReviewTemplate()
    const run = makeRun(t, {
      coder: { state: 'done' }, rev: { state: 'blocked', verdict: { concerns: ['x'], blocking: true } },
      gate: { state: 'queued' },
    })
    run.mode = 'auto'; run.round = 2
    const plan = planTick(t, run, {}, { now: 1, maxReviewRounds: 2, readArtifact: () => null })
    expect(plan.run.nodes.coder.state).toBe('done')     // not re-run
    expect(plan.events.some(e => e.type === 'graph.escalated')).toBe(true)
    expect(plan.blockedOn).toContain('gate')
  })

  it('a node whose pane exited non-zero becomes failed (not done)', () => {
    const t = makeReviewTemplate() // coder → rev → gate
    const run = makeRun(t, { coder: { state: 'running', paneId: 'p:coder' } })
    const plan = planTick(t, run, { coder: 'done' }, {
      now: 1, maxReviewRounds: 2, readArtifact: () => null,
      exitCode: (paneId) => (paneId === 'p:coder' ? 2 : null),
    })
    expect(plan.run.nodes.coder.state).toBe('failed')
    expect(plan.run.nodes.coder.exitCode).toBe(2)
  })
})

describe('dedupePersistentSignals', () => {
  const gateBlocked: DomainEvent = { type: 'graph.gate_blocked', ticketId: 't1', gateId: 'gate', blockedBy: ['rev-perf'] }
  const needsInput = (nodeId: string): DomainEvent => ({ type: 'graph.node_needs_input', ticketId: 't1', nodeId, role: 'reviewer' })

  it('emits a persistent signal once, then suppresses it on later ticks', () => {
    const first = dedupePersistentSignals([gateBlocked], new Set())
    expect(first.fresh).toHaveLength(1)
    const second = dedupePersistentSignals([gateBlocked], first.seen)
    expect(second.fresh).toHaveLength(0)
  })

  it('keys needs_input by node, so two different nodes both pass', () => {
    const out = dedupePersistentSignals([needsInput('rev-security'), needsInput('rev-types')], new Set())
    expect(out.fresh).toHaveLength(2)
    const again = dedupePersistentSignals([needsInput('rev-security')], out.seen)
    expect(again.fresh).toHaveLength(0)
  })

  it('dedupes graph.escalated by gate, so it fires once at the cap (not every tick)', () => {
    const escalated: DomainEvent = { type: 'graph.escalated', ticketId: 't1', gateId: 'gate', round: 2 }
    const first = dedupePersistentSignals([escalated], new Set())
    expect(first.fresh).toHaveLength(1)
    const second = dedupePersistentSignals([escalated], first.seen)
    expect(second.fresh).toHaveLength(0)
  })

  it('never dedupes transient events (started/done/completed)', () => {
    const transient: DomainEvent[] = [
      { type: 'graph.node_started', ticketId: 't1', nodeId: 'coder', role: 'coder' },
      { type: 'graph.node_done', ticketId: 't1', nodeId: 'coder', role: 'coder' },
      { type: 'graph.completed', ticketId: 't1', templateId: 'full' },
    ]
    const seen = new Set<string>()
    expect(dedupePersistentSignals(transient, seen).fresh).toHaveLength(3)
    expect(dedupePersistentSignals(transient, seen).fresh).toHaveLength(3)
  })

  it('does not mutate the incoming seen set', () => {
    const seen = new Set<string>()
    dedupePersistentSignals([gateBlocked], seen)
    expect(seen.size).toBe(0)
  })
})
