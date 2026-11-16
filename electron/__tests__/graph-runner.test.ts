import { describe, it, expect } from 'vitest'
import { defaultGraphTemplates } from '../integrations/graph-template'
import { readyNodes, gateState, advanceGraph, type GraphRun, type NodeRunState } from '../integrations/graph-runner'

const full = defaultGraphTemplates().find((t) => t.id === 'full')!

const run = (states: Record<string, NodeRunState>): GraphRun => ({
  runId: 'r', ticketId: 't', templateId: 'full', worktreePath: '/w', branch: 'b', startedAt: 0,
  mode: 'auto', round: 0,
  nodes: Object.fromEntries(full.nodes.map((n) => [n.id, { state: states[n.id] ?? 'queued' }])),
})

describe('graph-runner', () => {
  it('only the root (architect) is ready at start', () => {
    expect(readyNodes(full, run({}))).toEqual(['architect'])
  })

  it('after coder done, all 3 reviewers become ready together (fan-out)', () => {
    const r = readyNodes(full, run({ architect: 'done', coder: 'done' }))
    expect(r.slice().sort()).toEqual(['rev-perf', 'rev-security', 'rev-types'])
  })

  it('a node whose deps are not all done is not ready', () => {
    expect(readyNodes(full, run({ architect: 'done' }))).toEqual(['coder'])
    expect(readyNodes(full, run({ architect: 'running' }))).toEqual([])
  })

  it('gateState: waiting until all reviewers done, then passed when clean', () => {
    expect(gateState(full, run({ 'rev-security': 'done', 'rev-types': 'done' }), 'gate')).toBe('waiting')
    expect(gateState(full, run({ 'rev-security': 'done', 'rev-types': 'done', 'rev-perf': 'done' }), 'gate')).toBe('passed')
  })

  it('gateState: blocked (human-in-the-loop) when a reviewer needs input', () => {
    expect(gateState(full, run({ 'rev-security': 'done', 'rev-types': 'done', 'rev-perf': 'needs_input' }), 'gate')).toBe('blocked')
  })

  it('a gate node is never returned by readyNodes (resolved by advanceGraph, not launched)', () => {
    const r = readyNodes(full, run({ architect: 'done', coder: 'done', 'rev-security': 'done', 'rev-types': 'done', 'rev-perf': 'done' }))
    expect(r).not.toContain('gate')
  })

  it('advanceGraph starts newly-ready nodes and emits node_started once', () => {
    const out = advanceGraph(full, run({ architect: 'done' }))
    expect(out.toStart).toContain('coder')
    expect(out.events.filter((e) => e.type === 'graph.node_started' && e.nodeId === 'coder')).toHaveLength(1)
    // idempotent: a coder already 'running' is not re-started nor re-emitted
    const out2 = advanceGraph(full, run({ architect: 'done', coder: 'running' }))
    expect(out2.toStart).not.toContain('coder')
    expect(out2.events.some((e) => e.type === 'graph.node_started' && e.nodeId === 'coder')).toBe(false)
  })

  it('advanceGraph resolves a passed gate to toStart and marks its downstream ready', () => {
    const out = advanceGraph(full, run({ architect: 'done', coder: 'done', 'rev-security': 'done', 'rev-types': 'done', 'rev-perf': 'done' }))
    expect(out.toStart).toContain('gate')
  })

  it('advanceGraph emits gate_blocked and reports blockedOn when a reviewer needs input', () => {
    const out = advanceGraph(full, run({ architect: 'done', coder: 'done', 'rev-security': 'done', 'rev-types': 'done', 'rev-perf': 'needs_input' }))
    expect(out.blockedOn).toContain('gate')
    const ev = out.events.find((e) => e.type === 'graph.gate_blocked')
    expect(ev).toBeTruthy()
    expect(ev && ev.type === 'graph.gate_blocked' && ev.blockedBy).toContain('rev-perf')
  })

  it('advanceGraph marks completed when every terminal node is done', () => {
    const allDone = Object.fromEntries(full.nodes.map((n) => [n.id, 'done'])) as Record<string, NodeRunState>
    const out = advanceGraph(full, run(allDone))
    expect(out.completed).toBe(true)
    expect(out.events.some((e) => e.type === 'graph.completed')).toBe(true)
  })

  it('advanceGraph marks descendants of a failed node as skipped (in toSkip)', () => {
    const out = advanceGraph(full, run({ architect: 'done', coder: 'failed' }))
    expect(out.toSkip).toEqual(expect.arrayContaining(['rev-security', 'rev-types', 'rev-perf', 'gate', 'tester']))
    expect(out.completed).toBe(false)
  })
})
