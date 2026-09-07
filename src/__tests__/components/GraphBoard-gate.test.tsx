// Que el control de gate exista no sirve si no se llega a él. El gate no es un
// nodo clickeable en el flow (FlowNode devuelve un div sin onClick para kind
// 'gate'), así que la decisión tiene que vivir a nivel de run en el detalle, no
// colgada de la selección de un nodo.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { GraphBoard } from '../../components/GraphBoard'
import type { GraphTemplate, PersistedGraphRun } from '../../types'

const TEMPLATE: GraphTemplate = {
  id: 'full', name: 'Full', createdAt: 0, updatedAt: 0,
  nodes: [
    { id: 'coder', role: 'coder', kind: 'agent', agent: 'claude', dependsOn: [] },
    { id: 'sec', role: 'reviewer', kind: 'agent', agent: 'claude', focus: 'security', dependsOn: ['coder'] },
    { id: 'gate', role: 'gate', kind: 'gate', dependsOn: ['sec'] },
  ],
}

const RUN: PersistedGraphRun = {
  seen: [],
  run: {
    runId: 'r1', ticketId: 'T-77', templateId: 'full', worktreePath: '/w', branch: 'feat/x',
    startedAt: 0, mode: 'gate', round: 1,
    nodes: {
      coder: { state: 'done' },
      sec: { state: 'blocked', verdict: { concerns: ['el token se loguea en claro'], blocking: true } },
      gate: { state: 'queued' },
    },
  },
}

let approve: ReturnType<typeof vi.fn>

beforeEach(() => {
  approve = vi.fn(async () => ({ ok: true }))
  Object.assign(window as unknown as Record<string, unknown>, {
    graphRuns: {
      list: vi.fn(async () => [RUN]),
      start: vi.fn(),
      attach: vi.fn(),
      approve,
      requestChanges: vi.fn(async () => ({ ok: true })),
      setMode: vi.fn(async () => ({ ok: true })),
    },
    graphTemplates: { list: vi.fn(async () => [TEMPLATE]) },
  })
})

describe('GraphBoard · gate esperando decisión', () => {
  it('abre el run y ofrece aprobar el gate sin tener que seleccionar un nodo', async () => {
    render(<GraphBoard onClose={vi.fn()} activeRepoPath="/repo" />)

    fireEvent.click(await screen.findByText('T-77'))

    // Sin tocar ningún nodo: el concern y las dos salidas ya están a la vista.
    expect(await screen.findByText('el token se loguea en claro')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /approve anyway/i }))
    await waitFor(() => expect(approve).toHaveBeenCalledWith('r1', 'gate'))
  })
})
