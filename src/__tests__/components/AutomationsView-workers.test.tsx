// @vitest-environment jsdom
// AutomationsView's Workers section — a minimal single-step worker-spec
// library (list/create/delete) via window.workerSpecs. No real IPC here;
// window.workerSpecs/window.automations/window.worktree are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AutomationsView } from '../../components/AutomationsView'
import type { WorkerSpec } from '../../types'

function makeWorker(over: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    id: 'w1',
    name: 'Code reviewer',
    steps: [{ agent: 'claude', model: 'sonnet' }],
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  }
}

function mockWorkerSpecsBridge(list: WorkerSpec[]) {
  window.workerSpecs = {
    list: vi.fn(() => Promise.resolve(list)),
    save: vi.fn((input) => Promise.resolve(makeWorker({ id: 'new', ...input }))),
    delete: vi.fn(() => Promise.resolve(true)),
  } as never
}

beforeEach(() => {
  mockWorkerSpecsBridge([])
  window.automations = {
    list: vi.fn(() => Promise.resolve([])),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as never
  window.worktree = {
    ...window.worktree,
    listAll: vi.fn(() => Promise.resolve({ ok: true, worktrees: [] })),
  } as never
})

describe('<AutomationsView> — Workers list', () => {
  it('renders the Workers section header and lead copy', async () => {
    render(<AutomationsView />)
    expect(screen.getByText('Workers')).toBeInTheDocument()
    expect(screen.getByText(/Reusable task types/)).toBeInTheDocument()
  })

  it('shows the empty state when there are no workers', async () => {
    render(<AutomationsView />)
    await waitFor(() => expect(screen.getByText(/No workers yet/)).toBeInTheDocument())
  })

  it('renders a worker row with its name and agent:model summary', async () => {
    mockWorkerSpecsBridge([makeWorker({ name: 'Code reviewer', steps: [{ agent: 'claude', model: 'sonnet' }] })])
    render(<AutomationsView />)

    await waitFor(() => expect(screen.getByText('Code reviewer')).toBeInTheDocument())
    expect(screen.getByText('claude:sonnet')).toBeInTheDocument()
  })

  it('a worker step with no model summarizes as just the agent name', async () => {
    mockWorkerSpecsBridge([makeWorker({ name: 'Triage bot', steps: [{ agent: 'codex' }] })])
    render(<AutomationsView />)

    await waitFor(() => expect(screen.getByText('Triage bot')).toBeInTheDocument())
    expect(screen.getByText('codex')).toBeInTheDocument()
  })
})

describe('<AutomationsView> — Workers create form', () => {
  it('"+ New worker" opens the form with name, agent, and instructions fields', async () => {
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New worker' }))

    expect(screen.getByPlaceholderText(/Name \(e\.g\. Code reviewer\)/)).toBeInTheDocument()
    expect(screen.getByLabelText('Agent')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Instructions for this worker/)).toBeInTheDocument()
  })

  it('the agent select offers exactly claude, gemini, codex, copilot, opencode', async () => {
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New worker' }))

    const agentSelect = screen.getByLabelText('Agent') as HTMLSelectElement
    const values = Array.from(agentSelect.options).map((o) => o.value)
    expect(values).toEqual(['claude', 'gemini', 'codex', 'copilot', 'opencode'])
  })

  it('shows a Model select for claude (has AI_CONFIG.models) but not for codex', async () => {
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New worker' }))

    expect(screen.getByLabelText('Model')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'codex' } })
    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument()
  })

  it('submitting the form calls workerSpecs.save with the entered name and agent, then closes and refreshes', async () => {
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New worker' }))

    fireEvent.change(screen.getByPlaceholderText(/Name \(e\.g\. Code reviewer\)/), { target: { value: 'Security auditor' } })
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'gemini' } })
    fireEvent.change(screen.getByPlaceholderText(/Instructions for this worker/), { target: { value: 'Audit for security issues.' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(window.workerSpecs.save).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Security auditor',
      steps: [expect.objectContaining({ agent: 'gemini', instructions: 'Audit for security issues.' })],
    })))

    await waitFor(() => expect(screen.queryByPlaceholderText(/Instructions for this worker/)).not.toBeInTheDocument())
    expect(window.workerSpecs.list).toHaveBeenCalledTimes(2) // initial load + refresh after create
  })
})

describe('<AutomationsView> — Workers delete', () => {
  it('clicking a worker\'s delete button calls workerSpecs.delete with its id', async () => {
    mockWorkerSpecsBridge([makeWorker({ id: 'w42', name: 'Doc writer' })])
    render(<AutomationsView />)
    await waitFor(() => expect(screen.getByText('Doc writer')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Delete Doc writer' }))

    await waitFor(() => expect(window.workerSpecs.delete).toHaveBeenCalledWith('w42'))
  })
})
