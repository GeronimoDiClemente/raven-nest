// Blocker C del handoff 2026-08-22: los handlers `graph:run:setMode`,
// `graph:gate:approve` y `graph:gate:requestChanges` existían en main y andaban,
// pero no había ni bridge ni botón. Esta es la barra que los usa.
//
// Regla que el componente respeta: aprobar/pedir cambios NO aplica nada, encola
// un pendingDecision que el tick del orquestador aplica. Por eso, con una decisión
// ya encolada, los botones se apagan en vez de dejar mandar otra.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { GraphRunDecision } from '../../components/GraphRunDecision'
import type { GraphTemplate, GraphRun, NodeRuntime } from '../../types'

const TEMPLATE: GraphTemplate = {
  id: 'full', name: 'Full', createdAt: 0, updatedAt: 0,
  nodes: [
    { id: 'coder', role: 'coder', kind: 'agent', agent: 'claude', dependsOn: [] },
    { id: 'sec', role: 'reviewer', kind: 'agent', agent: 'claude', focus: 'security', dependsOn: ['coder'] },
    { id: 'gate', role: 'gate', kind: 'gate', dependsOn: ['sec'] },
    { id: 'tester', role: 'tester', kind: 'agent', agent: 'claude', dependsOn: ['gate'] },
  ],
}

function makeRun(over: Partial<GraphRun> = {}, nodes: Record<string, NodeRuntime> = {}): GraphRun {
  return {
    runId: 'r1', ticketId: 'T-1', templateId: 'full', worktreePath: '/w', branch: 'feat/x',
    startedAt: 0, mode: 'gate', round: 1,
    nodes: {
      coder: { state: 'done' },
      // Un reviewer que bloquea queda en 'blocked' (lo deja ahi el verdict pass),
      // y el gate NUNCA sale de 'queued' mientras lo retienen: su estado se deriva.
      sec: { state: 'blocked', verdict: { concerns: ['el token se loguea en claro'], blocking: true } },
      gate: { state: 'queued' },
      tester: { state: 'queued' },
      ...nodes,
    },
    ...over,
  }
}

let approve: ReturnType<typeof vi.fn>
let requestChanges: ReturnType<typeof vi.fn>
let setMode: ReturnType<typeof vi.fn>

beforeEach(() => {
  approve = vi.fn(async () => ({ ok: true }))
  requestChanges = vi.fn(async () => ({ ok: true }))
  setMode = vi.fn(async () => ({ ok: true }))
  Object.assign(window as unknown as Record<string, unknown>, {
    graphRuns: { list: vi.fn(async () => []), approve, requestChanges, setMode },
  })
})

describe('GraphRunDecision', () => {
  it('lista los concerns que bloquean, atribuidos al reviewer que los escribió', () => {
    render(<GraphRunDecision run={makeRun()} template={TEMPLATE} onChanged={vi.fn()} />)
    expect(screen.getByText('reviewer · security')).toBeTruthy()
    expect(screen.getByText('el token se loguea en claro')).toBeTruthy()
  })

  it('aprobar igual encola la decisión para el gate que está esperando', async () => {
    const onChanged = vi.fn()
    render(<GraphRunDecision run={makeRun()} template={TEMPLATE} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: /approve anyway/i }))
    expect(approve).toHaveBeenCalledWith('r1', 'gate')
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('pedir cambios sin escribir nada no manda la decisión', async () => {
    render(<GraphRunDecision run={makeRun()} template={TEMPLATE} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }))
    expect(requestChanges).not.toHaveBeenCalled()
    expect(screen.getByText(/write what needs to change/i)).toBeTruthy()
  })

  it('pedir cambios manda el texto que escribió el humano', async () => {
    render(<GraphRunDecision run={makeRun()} template={TEMPLATE} onChanged={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/what needs to change/i), { target: { value: 'sacá el log del token' } })
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }))
    expect(requestChanges).toHaveBeenCalledWith('r1', 'sacá el log del token')
  })

  it('cambiar el modo del run llama al bridge', async () => {
    const onChanged = vi.fn()
    render(<GraphRunDecision run={makeRun()} template={TEMPLATE} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'auto' }))
    expect(setMode).toHaveBeenCalledWith('r1', 'auto')
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('con una decisión ya encolada apaga los botones en vez de dejar mandar otra', async () => {
    const run = makeRun({ pendingDecision: { kind: 'approve', gateId: 'gate' } })
    render(<GraphRunDecision run={run} template={TEMPLATE} onChanged={vi.fn()} />)
    expect(screen.getByRole('button', { name: /approve anyway/i }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /request changes/i }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/applies on the next tick/i)).toBeTruthy()
  })

  it('sin gate esperando no muestra la decisión, pero el modo se sigue pudiendo cambiar', () => {
    const run = makeRun({}, { sec: { state: 'running' } })
    render(<GraphRunDecision run={run} template={TEMPLATE} onChanged={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /approve anyway/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'auto' })).toBeTruthy()
  })

  it('no se rompe si el preload viejo no expone las decisiones', async () => {
    // Un update parcial deja un preload sin estos métodos; la pantalla no puede caerse.
    Object.assign(window as unknown as Record<string, unknown>, { graphRuns: { list: vi.fn(async () => []) } })
    render(<GraphRunDecision run={makeRun()} template={TEMPLATE} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /approve anyway/i }))
    expect(screen.getByRole('button', { name: /approve anyway/i })).toBeTruthy()
  })
})
