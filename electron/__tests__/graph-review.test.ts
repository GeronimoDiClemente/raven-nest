import { describe, it, expect } from 'vitest'
import { resetBranchForRerun, applyDecision } from '../integrations/graph-review'
import type { GraphTemplate } from '../integrations/graph-template'
import type { GraphRun } from '../integrations/graph-runner'

const T: GraphTemplate = {
  id: 'full', name: 'full', nodes: [
    { id: 'architect', role: 'architect', kind: 'agent', dependsOn: [] },
    { id: 'coder', role: 'coder', kind: 'agent', dependsOn: ['architect'] },
    { id: 'rev', role: 'reviewer', kind: 'agent', dependsOn: ['coder'] },
    { id: 'gate', role: 'gate', kind: 'gate', dependsOn: ['rev'] },
  ], createdAt: 0, updatedAt: 0,
}
const run = (): GraphRun => ({
  runId: 'r', ticketId: 't', templateId: 'full', worktreePath: '/w', branch: 'b',
  startedAt: 0, mode: 'auto', round: 0, nodes: {
    architect: { state: 'done' }, coder: { state: 'done', paneId: 'p:coder', endedAt: 5 },
    rev: { state: 'blocked', paneId: 'p:rev', verdict: { concerns: ['x'], blocking: true } },
    gate: { state: 'queued' },
  },
})

describe('resetBranchForRerun', () => {
  it('resets coder + descendants to queued, keeps architect done', () => {
    const next = resetBranchForRerun(T, run(), 'scope key per attempt')
    expect(next.nodes.architect.state).toBe('done')
    expect(next.nodes.coder.state).toBe('queued')
    expect(next.nodes.rev.state).toBe('queued')
    expect(next.nodes.gate.state).toBe('queued')
  })
  it('clears paneId/endedAt/verdict on the reset nodes', () => {
    const next = resetBranchForRerun(T, run(), 'fix')
    expect(next.nodes.coder.paneId).toBeUndefined()
    expect(next.nodes.coder.endedAt).toBeUndefined()
    expect(next.nodes.rev.verdict).toBeUndefined()
  })
  it('stores the feedback as revisionNote on the coder and bumps round', () => {
    const next = resetBranchForRerun(T, run(), 'scope key per attempt')
    expect(next.revisionNotes!.coder).toBe('scope key per attempt')
    expect(next.round).toBe(1)
  })
  it('does not mutate the input run', () => {
    const r = run(); resetBranchForRerun(T, r, 'f')
    expect(r.nodes.coder.state).toBe('done')
  })
})

describe('applyDecision', () => {
  it('approve: overrides blocked reviewers + gate to done and clears the decision', () => {
    const r = run(); r.pendingDecision = { kind: 'approve', gateId: 'gate' }
    const next = applyDecision(T, r)
    expect(next.nodes.rev.state).toBe('done')
    expect(next.nodes.gate.state).toBe('done')
    expect(next.pendingDecision).toBeUndefined()
  })
  it('requestChanges: re-runs the coder branch with the feedback and clears the decision', () => {
    const r = run(); r.pendingDecision = { kind: 'requestChanges', feedback: 'per-attempt key' }
    const next = applyDecision(T, r)
    expect(next.nodes.coder.state).toBe('queued')
    expect(next.revisionNotes!.coder).toBe('per-attempt key')
    expect(next.round).toBe(1)
    expect(next.pendingDecision).toBeUndefined()
  })
  it('no-op when there is no pending decision', () => {
    const r = run()
    expect(applyDecision(T, r)).toEqual(r)
  })
})
