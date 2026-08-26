import { describe, it, expect } from 'vitest'
import { provenanceBlock, runLink } from '../integrations/memory-provenance'
import type { GraphRun } from '../integrations/graph-runner'

const run: GraphRun = {
  runId: 'r1', ticketId: 't-42', templateId: 'full', worktreePath: '/w', repoPath: '/repo',
  branch: 'feat/x', nodes: {}, startedAt: 0, mode: 'auto', round: 2,
}

describe('runLink', () => {
  it('builds a stable wikilink from the runId', () => {
    expect(runLink('r1')).toBe('[[run-r1]]')
  })
})

describe('provenanceBlock', () => {
  it('includes run, node, branch, ticket, round and the run wikilink', () => {
    const out = provenanceBlock(run, { nodeId: 'rev-security', role: 'reviewer', focus: 'security', verdict: 'blocking' })
    expect(out).toContain('run r1')
    expect(out).toContain('rev-security')
    expect(out).toContain('reviewer/security')
    expect(out).toContain('feat/x')
    expect(out).toContain('t-42')
    expect(out).toContain('Ronda: 2')
    expect(out).toContain('[[run-r1]]')
  })

  it('omits the node line when there is no node', () => {
    const out = provenanceBlock(run, {})
    expect(out).not.toContain('Nodo:')
    expect(out).toContain('[[run-r1]]')
  })
})
