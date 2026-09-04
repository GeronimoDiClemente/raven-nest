import { describe, it, expect } from 'vitest'
import { artifactPath, composeNodeInput } from '../integrations/graph-handoff'
import type { GraphNode } from '../integrations/graph-template'

const node = (p: Partial<GraphNode> & Pick<GraphNode, 'id' | 'role'>): GraphNode => ({
  kind: 'agent', dependsOn: [], ...p,
})

describe('graph-handoff', () => {
  it('artifactPath: reviewers → review-<focus>.json, others → <id>.md', () => {
    expect(artifactPath(node({ id: 'rev-security', role: 'reviewer', focus: 'security' }))).toBe('.nest/graph/review-security.json')
    expect(artifactPath(node({ id: 'architect', role: 'architect' }))).toBe('.nest/graph/architect.md')
    expect(artifactPath(node({ id: 'r', role: 'reviewer' }))).toBe('.nest/graph/review-r.json')
  })

  it('composeNodeInput prepends the upstream artifact, then instructions, then the write-artifact line (non-leaf)', () => {
    const input = composeNodeInput(
      node({ id: 'coder', role: 'coder', dependsOn: ['architect'] }),
      [{ role: 'architect', content: '1. do X\n2. do Y' }],
      false,
    )
    expect(input).toContain('architect')
    expect(input).toContain('1. do X')
    expect(input).toContain('.nest/graph/coder.md')
  })

  it('includes every upstream artifact for a fan-in node, labeled by focus', () => {
    const input = composeNodeInput(
      node({ id: 'tester', role: 'tester', dependsOn: ['gate'] }),
      [
        { role: 'reviewer', focus: 'security', content: 'no auth issues' },
        { role: 'reviewer', focus: 'types', content: 'types ok' },
        { role: 'reviewer', focus: 'performance', content: 'watch the TTL' },
      ],
      true, // leaf → no write-artifact instruction
    )
    expect(input).toContain('security')
    expect(input).toContain('types')
    expect(input).toContain('performance')
    expect(input).toContain('no auth issues')
    expect(input).not.toContain('.nest/graph/') // leaf writes no artifact
  })

  it('uses role-default instructions when the node has none', () => {
    const input = composeNodeInput(node({ id: 'architect', role: 'architect' }), [], false)
    expect(input.toLowerCase()).toContain('plan')
  })

  it('honors explicit node instructions over the role default', () => {
    const input = composeNodeInput(node({ id: 'coder', role: 'coder', instructions: 'CUSTOM ORDER' }), [], false)
    expect(input).toContain('CUSTOM ORDER')
  })

  it('prepends a revision note when re-running a node', () => {
    const out = composeNodeInput(node({ id: 'coder', role: 'coder' }), [], false, 'scope the key per attempt')
    expect(out).toContain('Revision requested: scope the key per attempt')
  })

  // Real reviewers wrapped the verdict in a richer object, costing a wasted
  // auto-repair round (live smoke). The prompt must demand the exact top-level
  // shape parseVerdict prompts for, so the first pass parses.
  it('reviewer instructions demand a strict top-level {concerns, blocking} JSON', () => {
    const out = composeNodeInput(node({ id: 'rev', role: 'reviewer', focus: 'security' }), [], true)
    expect(out).toContain('"concerns"')
    expect(out).toContain('"blocking"')
    expect(out.toLowerCase()).toContain('top-level')
    // must steer away from wrapping/nesting the verdict
    expect(out.toLowerCase()).toContain('only these two')
  })
})
