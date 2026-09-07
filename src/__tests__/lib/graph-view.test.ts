import { describe, it, expect } from 'vitest'
import { toFlow, type FlowInputNode } from '../../lib/graph-view'
import { defaultGraphTemplates } from '../../../electron/integrations/graph-template'

const full = defaultGraphTemplates().find((t) => t.id === 'full')!
const inputs = (): FlowInputNode[] =>
  full.nodes.map((n) => ({ id: n.id, role: n.role, kind: n.kind, focus: n.focus, dependsOn: n.dependsOn, state: 'queued' }))

describe('graph-view.toFlow', () => {
  it('produces one RF node per graph node and one edge per dependency', () => {
    const { nodes, edges } = toFlow(inputs())
    expect(nodes).toHaveLength(7)
    const depCount = inputs().reduce((a, n) => a + n.dependsOn.length, 0)
    expect(edges).toHaveLength(depCount) // 8 for the full template
    expect(edges).toContainEqual({ id: 'coder->rev-security', source: 'coder', target: 'rev-security' })
  })

  it('lays out by rank: architect → coder → reviewers (shared) → gate → tester, left to right', () => {
    const { nodes } = toFlow(inputs())
    const x = (id: string) => nodes.find((n) => n.id === id)!.position.x
    expect(x('architect')).toBe(0)
    expect(x('coder')).toBeGreaterThan(x('architect'))
    expect(x('rev-security')).toBe(x('rev-types'))
    expect(x('rev-types')).toBe(x('rev-perf'))
    expect(x('rev-security')).toBeGreaterThan(x('coder'))
    expect(x('gate')).toBeGreaterThan(x('rev-security'))
    expect(x('tester')).toBeGreaterThan(x('gate'))
  })

  it('gives the fanned-out reviewers distinct y positions within their rank', () => {
    const { nodes } = toFlow(inputs())
    const ys = ['rev-security', 'rev-types', 'rev-perf'].map((id) => nodes.find((n) => n.id === id)!.position.y)
    expect(new Set(ys).size).toBe(3)
  })

  it('carries node role/focus/state into data for the custom node renderer', () => {
    const withState = inputs().map((n) => (n.id === 'coder' ? { ...n, state: 'running' as const } : n))
    const { nodes } = toFlow(withState)
    const coder = nodes.find((n) => n.id === 'coder')!
    expect(coder.data.state).toBe('running')
    const revSec = nodes.find((n) => n.id === 'rev-security')!
    expect(revSec.data.focus).toBe('security')
    expect(nodes.find((n) => n.id === 'gate')!.data.kind).toBe('gate')
  })
})
