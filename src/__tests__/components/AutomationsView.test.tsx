// @vitest-environment jsdom
// AutomationsView loads/creates/toggles/deletes scheduled agents via
// window.automations (electron/integrations/scheduler.ts on the main side).
// No real IPC here — window.automations/window.worktree are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { AutomationsView } from '../../components/AutomationsView'
import type { Automation } from '../../types'

function makeAutomation(over: Partial<Automation> = {}): Automation {
  return {
    id: 'a1',
    name: 'Nightly security audit',
    trigger: 'daily',
    time: '18:00',
    prompt: 'Audit the repo for security issues and summarize.',
    enabled: true,
    createdAt: 1000,
    updatedAt: 1000,
    nextRunAt: Date.UTC(2026, 0, 6, 18, 0, 0),
    scheduleLabel: 'Daily at 18:00',
    ...over,
  }
}

function mockAutomationsBridge(list: Automation[]) {
  window.automations = {
    list: vi.fn(() => Promise.resolve(list)),
    create: vi.fn((input) => Promise.resolve(makeAutomation({ id: 'new', ...input }))),
    update: vi.fn((id, patch) => Promise.resolve(makeAutomation({ id, ...patch }))),
    delete: vi.fn(() => Promise.resolve(true)),
  } as never
}

beforeEach(() => {
  mockAutomationsBridge([])
  window.worktree = {
    ...window.worktree,
    listAll: vi.fn(() => Promise.resolve({ ok: true, worktrees: [] })),
  } as never
})

describe('<AutomationsView> — list', () => {
  it('renders the title and lead copy (no longer the coming-soon placeholder)', async () => {
    render(<AutomationsView />)
    expect(screen.getByText('Automations')).toBeInTheDocument()
    expect(screen.getByText(/event-driven/i)).toBeInTheDocument()
    expect(screen.queryByText(/Coming soon/)).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no automations', async () => {
    render(<AutomationsView />)
    await waitFor(() => expect(screen.getByText(/No automations yet/)).toBeInTheDocument())
  })

  it('renders a row with name, schedule label, repo chip, provider chip, next run and an On toggle', async () => {
    mockAutomationsBridge([makeAutomation({ repo: '/repos/widgets', provider: 'claude' })])
    render(<AutomationsView />)

    await waitFor(() => expect(screen.getByText('Nightly security audit')).toBeInTheDocument())
    expect(screen.getByText('Daily at 18:00')).toBeInTheDocument()
    expect(screen.getByText('widgets')).toBeInTheDocument()
    expect(screen.getByText('claude')).toBeInTheDocument()
    expect(screen.getByText(/^Next:/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'On' })).toBeInTheDocument()
  })

  it('a disabled automation renders the Off toggle', async () => {
    mockAutomationsBridge([makeAutomation({ enabled: false })])
    render(<AutomationsView />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Off' })).toBeInTheDocument())
  })

  it('an automation with no next run shows "Not scheduled"', async () => {
    mockAutomationsBridge([makeAutomation({ nextRunAt: null })])
    render(<AutomationsView />)
    await waitFor(() => expect(screen.getByText('Not scheduled')).toBeInTheDocument())
  })
})

describe('<AutomationsView> — toggle / delete', () => {
  it('clicking the toggle calls automations.update with the flipped enabled flag and refreshes', async () => {
    mockAutomationsBridge([makeAutomation({ enabled: true })])
    render(<AutomationsView />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'On' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'On' }))

    await waitFor(() => expect(window.automations.update).toHaveBeenCalledWith('a1', { enabled: false }))
    expect(window.automations.list).toHaveBeenCalledTimes(2) // initial load + refresh after toggle
  })

  it('clicking delete calls automations.delete and refreshes', async () => {
    mockAutomationsBridge([makeAutomation()])
    render(<AutomationsView />)
    await waitFor(() => expect(screen.getByText('Nightly security audit')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Delete Nightly security audit' }))

    await waitFor(() => expect(window.automations.delete).toHaveBeenCalledWith('a1'))
  })
})

describe('<AutomationsView> — create form', () => {
  it('"+ New automation" opens the form with all fields and a Cancel action', async () => {
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New automation' }))

    expect(screen.getByPlaceholderText(/Name/)).toBeInTheDocument()
    expect(screen.getByLabelText('Schedule')).toBeInTheDocument()
    expect(screen.getByLabelText('Time')).toBeInTheDocument() // default preset is "daily"
    expect(screen.getByPlaceholderText(/Prompt for the agent/)).toBeInTheDocument()
    expect(screen.getByLabelText('Repo')).toBeInTheDocument()
    expect(screen.getByLabelText('Provider')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('submits a preset schedule: create is called with the preset trigger + time, then the form closes and the list reloads', async () => {
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New automation' }))

    fireEvent.change(screen.getByPlaceholderText(/Name/), { target: { value: 'Nightly audit' } })
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '20:00' } })
    fireEvent.change(screen.getByPlaceholderText(/Prompt for the agent/), { target: { value: 'Do the audit' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(window.automations.create).toHaveBeenCalledWith({
      name: 'Nightly audit',
      trigger: 'daily',
      time: '20:00',
      prompt: 'Do the audit',
      repo: undefined,
      provider: 'claude',
    }))
    // Form closes after a successful create.
    await waitFor(() => expect(screen.queryByPlaceholderText(/Prompt for the agent/)).not.toBeInTheDocument())
  })

  it('switching schedule to "Custom (cron)" swaps the time input for a cron text field and sends it as the trigger', async () => {
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New automation' }))

    fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: 'custom' } })
    expect(screen.queryByLabelText('Time')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Cron expression')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText(/Name/), { target: { value: 'Weekday triage' } })
    fireEvent.change(screen.getByLabelText('Cron expression'), { target: { value: '0 18 * * 1-5' } })
    fireEvent.change(screen.getByPlaceholderText(/Prompt for the agent/), { target: { value: 'Triage issues' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(window.automations.create).toHaveBeenCalledWith(expect.objectContaining({
      trigger: '0 18 * * 1-5',
      time: undefined,
    })))
  })

  it('the "hourly" preset hides the time input entirely', async () => {
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New automation' }))
    fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: 'hourly' } })
    expect(screen.queryByLabelText('Time')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Cron expression')).not.toBeInTheDocument()
  })

  it('rejects submission with an empty name/prompt without calling automations.create', async () => {
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New automation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(window.automations.create).not.toHaveBeenCalled()
    expect(await screen.findByText(/required/i)).toBeInTheDocument()
  })

  it('lists linked repos (deduped by root repo path) as options in the repo select', async () => {
    window.worktree = {
      ...window.worktree,
      listAll: vi.fn(() => Promise.resolve({
        ok: true,
        worktrees: [
          { repoPath: '/repos/widgets', rootRepoPath: '/repos/widgets', branch: 'main' } as never,
          { repoPath: '/repos/widgets/wt-x', rootRepoPath: '/repos/widgets', branch: 'feat/x' } as never,
          { repoPath: '/repos/gizmos', rootRepoPath: '/repos/gizmos', branch: 'main' } as never,
        ],
      })),
    } as never
    render(<AutomationsView />)
    fireEvent.click(screen.getByRole('button', { name: '+ New automation' }))

    const repoSelect = await screen.findByLabelText('Repo')
    const optionLabels = within(repoSelect).getAllByRole('option').map((o) => o.textContent)
    expect(optionLabels).toEqual(['No repo', 'gizmos', 'widgets'])
  })
})
