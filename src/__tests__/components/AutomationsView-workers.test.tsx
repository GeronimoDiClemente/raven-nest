// @vitest-environment jsdom
// AutomationsView's Workers section — a worker-spec library (list/create/
// delete) with a multi-step (pipeline) create form, via window.workerSpecs.
// No real IPC here; window.workerSpecs/window.automations/window.worktree
// are mocked.
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
  window.accounts = {
    list: vi.fn(() => Promise.resolve([])),
    save: vi.fn(),
    delete: vi.fn(),
    getDir: vi.fn(),
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

  it('shows an Account select for a claude step (with saved accounts) and saves the chosen account on the step', async () => {
    window.accounts = {
      list: vi.fn(() => Promise.resolve(['Gero Lulea', 'Gero Personal'])),
      save: vi.fn(),
      delete: vi.fn(),
      getDir: vi.fn(),
    } as never

    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New worker' }))

    const accountSelect = await screen.findByLabelText('Account') as HTMLSelectElement
    const values = Array.from(accountSelect.options).map((o) => o.value)
    expect(values).toEqual(['', 'Gero Lulea', 'Gero Personal'])

    fireEvent.change(screen.getByPlaceholderText(/Name \(e\.g\. Code reviewer\)/), { target: { value: 'Claude worker' } })
    fireEvent.change(accountSelect, { target: { value: 'Gero Personal' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(window.workerSpecs.save).toHaveBeenCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({ agent: 'claude', account: 'Gero Personal' })],
    })))
  })

  it('shows no Account select for an opencode step (noAccount agent)', async () => {
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New worker' }))

    expect(await screen.findByLabelText('Account')).toBeInTheDocument() // default step is claude

    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'opencode' } })
    expect(screen.queryByLabelText('Account')).not.toBeInTheDocument()
  })

  it('changing a step\'s agent resets its stored account', async () => {
    window.accounts = {
      list: vi.fn(() => Promise.resolve(['Gero Personal'])),
      save: vi.fn(),
      delete: vi.fn(),
      getDir: vi.fn(),
    } as never

    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New worker' }))

    const accountSelect = await screen.findByLabelText('Account') as HTMLSelectElement
    fireEvent.change(accountSelect, { target: { value: 'Gero Personal' } })
    expect(accountSelect.value).toBe('Gero Personal')

    // codex also has saved accounts loaded (same mock), but switching to it
    // must NOT carry over claude's chosen account.
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'codex' } })
    const codexAccountSelect = await screen.findByLabelText('Account') as HTMLSelectElement
    expect(codexAccountSelect.value).toBe('')
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

  it('a fresh form has 1 step with no remove button; "+ Add step" adds a 2nd step (each removable), and removing one goes back to 1 with no remove button', async () => {
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New worker' }))

    expect(screen.getAllByLabelText('Agent')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Remove step/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ Add step' }))
    expect(screen.getAllByLabelText('Agent')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /Remove step/ })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: /Remove step/ })[1])
    expect(screen.getAllByLabelText('Agent')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Remove step/ })).not.toBeInTheDocument()
  })

  it('adding a 2nd step and submitting saves a 2-step pipeline, each step keeping its own agent/model/role', async () => {
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New worker' }))

    fireEvent.change(screen.getByPlaceholderText(/Name \(e\.g\. Code reviewer\)/), { target: { value: 'Explore then implement' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add step' }))

    // 2nd step: switch its agent to gemini (independent of step 1, which stays claude)
    // and give it its own model + role.
    const agentSelects = screen.getAllByLabelText('Agent')
    fireEvent.change(agentSelects[1], { target: { value: 'gemini' } })

    const modelSelects = screen.getAllByLabelText('Model')
    fireEvent.change(modelSelects[1], { target: { value: 'gemini-2.5-flash' } })

    const roleInputs = screen.getAllByPlaceholderText(/role \(optional\)/)
    fireEvent.change(roleInputs[1], { target: { value: 'implement' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(window.workerSpecs.save).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Explore then implement',
      steps: [
        expect.objectContaining({ agent: 'claude' }),
        expect.objectContaining({ agent: 'gemini', model: 'gemini-2.5-flash', role: 'implement' }),
      ],
    })))
    const savedSteps = (window.workerSpecs.save as ReturnType<typeof vi.fn>).mock.calls[0][0].steps
    expect(savedSteps).toHaveLength(2)
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
