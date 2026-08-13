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

  it('the agent select offers exactly claude, codex, gemini, copilot, opencode (in PROVIDER_OPTIONS order)', async () => {
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New worker' }))

    const agentSelect = screen.getByLabelText('Agent') as HTMLSelectElement
    const values = Array.from(agentSelect.options).map((o) => o.value)
    expect(values).toEqual(['claude', 'codex', 'gemini', 'copilot', 'opencode'])
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

  it('passes the selected model through to the save payload', async () => {
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New worker' }))

    fireEvent.change(screen.getByPlaceholderText(/Name \(e\.g\. Code reviewer\)/), { target: { value: 'Fast claude' } })
    // agent defaults to claude, which exposes a Model select (opus/sonnet/haiku)
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'haiku' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(window.workerSpecs.save).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Fast claude',
      steps: [expect.objectContaining({ agent: 'claude', model: 'haiku' })],
    })))
  })

  it('fully resets the form on reopen after creating a non-default (gemini + model) worker', async () => {
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New worker' }))

    fireEvent.change(screen.getByPlaceholderText(/Name \(e\.g\. Code reviewer\)/), { target: { value: 'Gemini pro worker' } })
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'gemini' } })
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gemini-2.5-pro' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    // Form closes on success.
    await waitFor(() => expect(screen.queryByLabelText('Agent')).not.toBeInTheDocument())

    // Reopen: everything is back to the defaults, not the gemini/model we just used.
    fireEvent.click(screen.getByRole('button', { name: '+ New worker' }))
    const agentSelect = screen.getByLabelText('Agent') as HTMLSelectElement
    expect(agentSelect.value).toBe('claude')
    // claude's Model select is shown again and blank (Default model), not gemini-2.5-pro.
    const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement
    expect(modelSelect.value).toBe('')
    expect(screen.getByPlaceholderText(/Name \(e\.g\. Code reviewer\)/)).toHaveValue('')
  })
})

describe('<AutomationsView> — Workers error handling', () => {
  it('surfaces an error and keeps the form open when save rejects', async () => {
    mockWorkerSpecsBridge([])
    window.workerSpecs.save = vi.fn(() => Promise.reject(new Error('disk full'))) as never

    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New worker' }))
    fireEvent.change(screen.getByPlaceholderText(/Name \(e\.g\. Code reviewer\)/), { target: { value: 'Doomed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('disk full')).toBeInTheDocument()
    // Form stays open so the user can retry.
    expect(screen.getByLabelText('Agent')).toBeInTheDocument()
  })

  it('surfaces an error when delete rejects instead of failing silently', async () => {
    mockWorkerSpecsBridge([makeWorker({ id: 'w9', name: 'Sticky worker' })])
    window.workerSpecs.delete = vi.fn(() => Promise.reject(new Error('delete failed'))) as never

    render(<AutomationsView />)
    await waitFor(() => expect(screen.getByText('Sticky worker')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Delete Sticky worker' }))

    expect(await screen.findByText('delete failed')).toBeInTheDocument()
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
