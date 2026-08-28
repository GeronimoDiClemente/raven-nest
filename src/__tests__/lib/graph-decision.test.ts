// El board necesita saber, mirando un run, si hay un gate esperando una decisión
// humana y qué concerns lo están frenando. Es lo que decide si se muestra la barra
// de decisión (blocker C del handoff 2026-08-22) y con qué contenido.
import { describe, it, expect } from 'vitest'
import { pendingGate } from '../../lib/graph-decision'
import type { GraphTemplate, GraphRun, NodeRunState } from '../../types'

const TEMPLATE: GraphTemplate = {
  id: 'full', name: 'Full', createdAt: 0, updatedAt: 0,
  nodes: [
    { id: 'coder', role: 'coder', kind: 'agent', agent: 'claude', dependsOn: [] },
    { id: 'sec', role: 'reviewer', kind: 'agent', agent: 'claude', focus: 'security', dependsOn: ['coder'] },
    { id: 'perf', role: 'reviewer', kind: 'agent', agent: 'claude', focus: 'performance', dependsOn: ['coder'] },
    { id: 'gate', role: 'gate', kind: 'gate', dependsOn: ['sec', 'perf'] },
    { id: 'tester', role: 'tester', kind: 'agent', agent: 'claude', dependsOn: ['gate'] },
  ],
}

function run(nodes: Record<string, { state: NodeRunState; verdict?: { concerns: string[]; blocking: boolean } }>): GraphRun {
  return {
    runId: 'r1', ticketId: 'T-1', templateId: 'full', worktreePath: '/w', branch: 'feat/x',
    startedAt: 0, mode: 'gate', round: 1, nodes,
  }
}

describe('pendingGate', () => {
  it('devuelve null cuando ningún gate está esperando', () => {
    const r = run({
      coder: { state: 'done' },
      sec: { state: 'running' },
      perf: { state: 'queued' },
      gate: { state: 'queued' },
      tester: { state: 'queued' },
    })
    expect(pendingGate(TEMPLATE, r)).toBeNull()
  })

  it('devuelve el gate bloqueado con los concerns de cada reviewer que bloqueó', () => {
    const r = run({
      coder: { state: 'done' },
      sec: { state: 'done', verdict: { concerns: ['el token se loguea en claro'], blocking: true } },
      perf: { state: 'done', verdict: { concerns: ['un N+1 en el listado'], blocking: true } },
      gate: { state: 'blocked' },
      tester: { state: 'queued' },
    })
    expect(pendingGate(TEMPLATE, r)).toEqual({
      gateId: 'gate',
      concerns: [
        { from: 'reviewer · security', items: ['el token se loguea en claro'] },
        { from: 'reviewer · performance', items: ['un N+1 en el listado'] },
      ],
    })
  })

  it('ignora a los reviewers que no bloquearon', () => {
    const r = run({
      coder: { state: 'done' },
      sec: { state: 'done', verdict: { concerns: ['el token se loguea en claro'], blocking: true } },
      perf: { state: 'done', verdict: { concerns: ['podría cachearse'], blocking: false } },
      gate: { state: 'blocked' },
      tester: { state: 'queued' },
    })
    expect(pendingGate(TEMPLATE, r)?.concerns).toEqual([
      { from: 'reviewer · security', items: ['el token se loguea en claro'] },
    ])
  })

  it('un gate en needs_input también espera decisión, aunque nadie haya bloqueado', () => {
    // Modo `gate`: el gate frena aunque el review haya pasado limpio. No hay
    // concerns que mostrar, pero sí hay que ofrecer los botones.
    const r = run({
      coder: { state: 'done' },
      sec: { state: 'done', verdict: { concerns: [], blocking: false } },
      perf: { state: 'done', verdict: { concerns: [], blocking: false } },
      gate: { state: 'needs_input' },
      tester: { state: 'queued' },
    })
    expect(pendingGate(TEMPLATE, r)).toEqual({ gateId: 'gate', concerns: [] })
  })

  it('con dos gates esperando devuelve el primero del template (orden determinístico)', () => {
    const two: GraphTemplate = {
      ...TEMPLATE,
      nodes: [
        ...TEMPLATE.nodes,
        { id: 'gate2', role: 'gate', kind: 'gate', dependsOn: ['tester'] },
      ],
    }
    const r = run({
      coder: { state: 'done' }, sec: { state: 'done' }, perf: { state: 'done' },
      gate: { state: 'blocked' }, tester: { state: 'done' }, gate2: { state: 'blocked' },
    })
    expect(pendingGate(two, r)?.gateId).toBe('gate')
  })
})
