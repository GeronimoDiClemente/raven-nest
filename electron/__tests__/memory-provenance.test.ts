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
    // run.round is 0-indexed (round 2 = third pass); displayed 1-indexed.
    expect(out).toContain('Ronda: 3')
    expect(out).toContain('[[run-r1]]')
    expect(out).toContain('Veredicto: bloqueante')
  })

  it('omits the node line when there is no node', () => {
    const out = provenanceBlock(run, {})
    expect(out).not.toContain('Nodo:')
    expect(out).toContain('[[run-r1]]')
  })

  it('renders the nodeId without parens when the node has no role', () => {
    const out = provenanceBlock(run, { nodeId: 'rev-security' })
    expect(out).toContain('Nodo: rev-security')
    expect(out).not.toContain('undefined')
    expect(out).not.toContain('()')
  })

  it('renders the agent and model on the Agente line when known', () => {
    const withBoth = provenanceBlock(run, { nodeId: 'rev-security', agent: 'claude', model: 'opus-4' })
    expect(withBoth).toContain('Agente: claude (opus-4)')

    const agentOnly = provenanceBlock(run, { nodeId: 'rev-security', agent: 'claude' })
    expect(agentOnly).toContain('Agente: claude')
    expect(agentOnly).not.toContain('()')
  })

  it('omits the Agente line when there is no agent', () => {
    const out = provenanceBlock(run, { nodeId: 'rev-security' })
    expect(out).not.toContain('Agente:')
  })

  it('translates every verdict to Spanish', () => {
    expect(provenanceBlock(run, { verdict: 'blocking' })).toContain('Veredicto: bloqueante')
    expect(provenanceBlock(run, { verdict: 'non-blocking' })).toContain('Veredicto: no bloqueante')
    expect(provenanceBlock(run, { verdict: 'human-approved' })).toContain('Veredicto: aprobado por humano')
    expect(provenanceBlock(run, { verdict: 'human-rejected' })).toContain('Veredicto: rechazado por humano')
  })
})
