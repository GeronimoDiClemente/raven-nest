import { describe, it, expect } from 'vitest'
import { defaultGraphTemplates, toGraphTemplate, hasCycle } from '../integrations/graph-template'

describe('graph-template', () => {
  it('ships 3 built-in templates (full/quick-fix/review-only), all valid DAGs', () => {
    const ids = defaultGraphTemplates().map((t) => t.id).sort()
    expect(ids).toEqual(['full', 'quick-fix', 'review-only'])
    for (const t of defaultGraphTemplates()) {
      expect(t.builtIn).toBe(true)
      expect(toGraphTemplate(t)).not.toBeNull()
      expect(hasCycle(t.nodes)).toBe(false)
    }
  })

  it('full template fans out to 3 reviewers into a gate before the tester', () => {
    const full = defaultGraphTemplates().find((t) => t.id === 'full')!
    const reviewers = full.nodes.filter((n) => n.role === 'reviewer')
    const gate = full.nodes.find((n) => n.kind === 'gate')!
    const tester = full.nodes.find((n) => n.role === 'tester')!
    expect(reviewers).toHaveLength(3)
    expect(gate.dependsOn.slice().sort()).toEqual(reviewers.map((r) => r.id).sort())
    expect(tester.dependsOn).toContain(gate.id)
  })

  it('toGraphTemplate rejects dangling dependsOn and cycles', () => {
    const dangling = {
      id: 'x', name: 'x', createdAt: 0, updatedAt: 0,
      nodes: [{ id: 'a', role: 'coder', kind: 'agent', dependsOn: ['ghost'] }],
    }
    expect(toGraphTemplate(dangling)).toBeNull()
    const cyclic = {
      id: 'y', name: 'y', createdAt: 0, updatedAt: 0,
      nodes: [
        { id: 'a', role: 'coder', kind: 'agent', dependsOn: ['b'] },
        { id: 'b', role: 'tester', kind: 'agent', dependsOn: ['a'] },
      ],
    }
    expect(toGraphTemplate(cyclic)).toBeNull()
  })

  it('toGraphTemplate rejects duplicate ids and empty node lists', () => {
    expect(toGraphTemplate({ id: 'z', name: 'z', createdAt: 0, updatedAt: 0, nodes: [] })).toBeNull()
    const dup = {
      id: 'd', name: 'd', createdAt: 0, updatedAt: 0,
      nodes: [
        { id: 'a', role: 'coder', kind: 'agent', dependsOn: [] },
        { id: 'a', role: 'tester', kind: 'agent', dependsOn: [] },
      ],
    }
    expect(toGraphTemplate(dup)).toBeNull()
  })

  it('hasCycle detects a back-edge, accepts a fan-in DAG', () => {
    expect(hasCycle([
      { id: 'a', role: 'coder', kind: 'agent', dependsOn: [] },
      { id: 'b', role: 'reviewer', kind: 'agent', dependsOn: ['a'] },
      { id: 'c', role: 'tester', kind: 'agent', dependsOn: ['b', 'a'] },
    ])).toBe(false)
    expect(hasCycle([
      { id: 'a', role: 'coder', kind: 'agent', dependsOn: ['c'] },
      { id: 'b', role: 'reviewer', kind: 'agent', dependsOn: ['a'] },
      { id: 'c', role: 'tester', kind: 'agent', dependsOn: ['b'] },
    ])).toBe(true)
  })
})
