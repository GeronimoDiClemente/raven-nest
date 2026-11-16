// El board necesita saber, mirando un run, si hay un gate esperando una decisión
// humana y qué concerns lo están frenando (blocker C del handoff 2026-08-22).
//
// OJO con el contrato, que no es el obvio: un gate retenido para decisión NO
// escribe estado en `run.nodes`. graph-orchestrator lo mete en `heldGates` →
// `plan.blockedOn`, y main solo persiste `plan.run`, así que `blockedOn` se
// descarta cada tick y nunca llega al renderer. Un gate solo pasa de 'queued' a
// 'done' (o 'skipped'): jamás vale 'blocked' ni 'needs_input'.
//
// Así que el estado del gate hay que DERIVARLO de sus upstream, igual que hace
// `gateState` en electron/integrations/graph-runner.ts. Este archivo es el
// espejo de esa lógica del lado del renderer — misma convención que
// src/lib/graph-view.ts, que no cruza el borde main/renderer.
import { describe, it, expect } from 'vitest'
import { pendingGate } from '../../lib/graph-decision'
import type { GraphTemplate, GraphRun, GraphMode, NodeRuntime } from '../../types'

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

function run(mode: GraphMode, nodes: Record<string, NodeRuntime>): GraphRun {
  return {
    runId: 'r1', ticketId: 'T-1', templateId: 'full', worktreePath: '/w', branch: 'feat/x',
    startedAt: 0, mode, round: 1,
    // Como los siembra graph:run:start: TODOS los nodos, gate incluido.
    nodes: { coder: { state: 'queued' }, sec: { state: 'queued' }, perf: { state: 'queued' }, gate: { state: 'queued' }, tester: { state: 'queued' }, ...nodes },
  }
}

/** Un reviewer que terminó limpio: el verdict pass lo deja en 'done'. */
const clean: NodeRuntime = { state: 'done', verdict: { concerns: [], blocking: false } }

describe('pendingGate', () => {
  it('devuelve null mientras algún upstream del gate no terminó', () => {
    const r = run('gate', { coder: { state: 'done' }, sec: { state: 'running' }, perf: { state: 'queued' } })
    expect(pendingGate(TEMPLATE, r)).toBeNull()
  })

  it('en modo gate retiene aunque el review haya pasado limpio, y el gate sigue en queued', () => {
    // El caso que el smoke in-app destapó: el gate NUNCA sale de 'queued' cuando
    // lo retienen, así que mirar su propio state no alcanza.
    const r = run('gate', { coder: { state: 'done' }, sec: clean, perf: clean })
    expect(r.nodes.gate.state).toBe('queued')   // el sistema real es así
    expect(pendingGate(TEMPLATE, r)).toEqual({ gateId: 'gate', concerns: [] })
  })

  it('en modo auto un gate limpio se resuelve solo — no hay decisión que pedir', () => {
    const r = run('auto', { coder: { state: 'done' }, sec: clean, perf: clean })
    expect(pendingGate(TEMPLATE, r)).toBeNull()
  })

  it('en modo step retiene igual que en gate', () => {
    const r = run('step', { coder: { state: 'done' }, sec: clean, perf: clean })
    expect(pendingGate(TEMPLATE, r)?.gateId).toBe('gate')
  })

  it('un reviewer que bloqueó frena el gate en cualquier modo, con sus concerns', () => {
    // El verdict pass deja al reviewer en 'blocked', no en 'done'.
    const r = run('auto', {
      coder: { state: 'done' },
      sec: { state: 'blocked', verdict: { concerns: ['el token se loguea en claro'], blocking: true } },
      perf: { state: 'blocked', verdict: { concerns: ['un N+1 en el listado'], blocking: true } },
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
    const r = run('gate', {
      coder: { state: 'done' },
      sec: { state: 'blocked', verdict: { concerns: ['el token se loguea en claro'], blocking: true } },
      perf: clean,
    })
    expect(pendingGate(TEMPLATE, r)?.concerns).toEqual([
      { from: 'reviewer · security', items: ['el token se loguea en claro'] },
    ])
  })

  it('un upstream failed también frena el gate, aunque no haya verdict', () => {
    const r = run('gate', { coder: { state: 'done' }, sec: clean, perf: { state: 'failed', exitCode: 1 } })
    expect(pendingGate(TEMPLATE, r)).toEqual({ gateId: 'gate', concerns: [] })
  })

  it('una vez aprobado el gate queda done y deja de pedir decisión', () => {
    // applyDecision fuerza el gate y sus deps a 'done' cuando el tick aplica el approve.
    const r = run('gate', { coder: { state: 'done' }, sec: clean, perf: clean, gate: { state: 'done' } })
    expect(pendingGate(TEMPLATE, r)).toBeNull()
  })

  it('un gate skipped por una falla aguas arriba no pide decisión', () => {
    const r = run('gate', { coder: { state: 'done' }, sec: clean, perf: clean, gate: { state: 'skipped' } })
    expect(pendingGate(TEMPLATE, r)).toBeNull()
  })

  it('con dos gates esperando devuelve el primero del template (orden determinístico)', () => {
    const two: GraphTemplate = {
      ...TEMPLATE,
      nodes: [...TEMPLATE.nodes, { id: 'gate2', role: 'gate', kind: 'gate', dependsOn: ['tester'] }],
    }
    const r = run('gate', {
      coder: { state: 'done' }, sec: clean, perf: clean, tester: { state: 'done' },
      gate: { state: 'queued' }, gate2: { state: 'queued' },
    })
    expect(pendingGate(two, r)?.gateId).toBe('gate')
  })
})
