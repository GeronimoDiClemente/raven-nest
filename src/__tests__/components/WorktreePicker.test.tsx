// WorktreePicker opens from a board task row (OrchestrationBoard/IntegrationsRail).
// Unlinked rows (row.branch === null) get a create form that reuses MyTicketsView's
// exact flow (tickets.branchName -> worktree.create -> tickets.startWork); linked
// rows get an Open action that shells out to the ticket URL. Mock every window
// bridge + the two data hooks (useGitHub, useUserRepos) so nothing touches
// real IPC/supabase (pattern from MyTicketsView.test.tsx / MyReposPanel-integrations.test.tsx).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { BoardRow } from '../../integrations/board'

vi.mock('../../hooks/useGitHub', () => ({
  useGitHub: () => ({
    isConnected: true, githubLogin: 'gero', githubToken: 'tok', loading: false, error: null,
    connectGitHub: vi.fn(), disconnectGitHub: vi.fn(),
  }),
}))

vi.mock('../../hooks/useUserRepos', () => ({
  useUserRepos: () => ({
    repos: [
      { id: 'r1', user_id: 'u1', repo_full_name: 'gero/repo1', repo_url: 'https://github.com/gero/repo1', added_at: '', local_path: '/repo1', provider: 'github' },
      { id: 'r2', user_id: 'u1', repo_full_name: 'RAVEN/x', repo_url: 'https://github.com/RAVEN/x', added_at: '', local_path: '/raven-x', provider: 'github' },
    ],
    loading: false, refresh: vi.fn(), addRepo: vi.fn(), updateLocalPath: vi.fn(), removeRepo: vi.fn(),
  }),
}))

import { WorktreePicker } from '../../components/WorktreePicker'

const unlinkedRow: BoardRow = {
  key: 'PROJ-9', title: 'Fix the thing', url: 'https://jira/PROJ-9', providerId: 'jira-9',
  pluginId: 'jira', ticketState: 'todo', status: 'todo', branch: null, worktreePath: null,
  repoFullName: null, scope: { kind: 'personal' }, ci: null, changesRequested: false, prNumber: null,
}

const linkedRow: BoardRow = {
  key: '#189', title: 'Race board', url: 'https://github.com/RAVEN/x/issues/189', providerId: 'x',
  pluginId: 'github', ticketState: 'in_review', status: 'needs_you', branch: 'gero/189-race',
  worktreePath: '/raven-x', repoFullName: 'RAVEN/x', scope: { kind: 'org', org: 'RAVEN' },
  ci: 'success', changesRequested: true, prNumber: 1,
}

beforeEach(() => {
  Object.assign(window as unknown as Record<string, unknown>, {
    tickets: {
      branchName: vi.fn().mockResolvedValue('gero/PROJ-9-fix-the-thing'),
      startWork: vi.fn().mockResolvedValue({ ok: true }),
    },
    worktree: {
      create: vi.fn().mockResolvedValue({ ok: true, meta: { repoPath: '/tmp/wt' } }),
    },
    workerSpecs: {
      list: vi.fn().mockResolvedValue([{
        id: 'w1', name: 'Bugfix Bot',
        steps: [{ agent: 'claude', model: 'haiku', instructions: 'Fix the failing test' }],
        createdAt: 0, updatedAt: 0,
      }]),
    },
    electronShell: { openExternal: vi.fn() },
  })
})

describe('WorktreePicker', () => {
  it('unlinked row: shows the suggested branch name and a Create button', async () => {
    render(<WorktreePicker row={unlinkedRow} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByDisplayValue('gero/PROJ-9-fix-the-thing')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /create worktree/i })).toBeInTheDocument()
    const tk = (window as unknown as { tickets: { branchName: ReturnType<typeof vi.fn> } }).tickets
    expect(tk.branchName).toHaveBeenCalledWith('gero', 'PROJ-9', 'Fix the thing')
  })

  it('unlinked row: Create calls worktree.create + tickets.startWork with the expected args and notifies onCreated', async () => {
    const onCreated = vi.fn()
    const onClose = vi.fn()
    render(<WorktreePicker row={unlinkedRow} onClose={onClose} onCreated={onCreated} />)
    await waitFor(() => expect(screen.getByDisplayValue('gero/PROJ-9-fix-the-thing')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /create worktree/i }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)

    const wt = (window as unknown as { worktree: { create: ReturnType<typeof vi.fn> } }).worktree
    expect(wt.create).toHaveBeenCalledWith({ repoPath: '/repo1', branch: 'gero/PROJ-9-fix-the-thing' })

    const tk = (window as unknown as { tickets: { startWork: ReturnType<typeof vi.fn> } }).tickets
    expect(tk.startWork).toHaveBeenCalledWith({
      pluginId: 'jira',
      ticket: { key: 'PROJ-9', providerId: 'jira-9', title: 'Fix the thing', url: 'https://jira/PROJ-9', state: 'todo', context: '' },
      branch: 'gero/PROJ-9-fix-the-thing',
      worktreePath: '/tmp/wt',
    })
  })

  it('unlinked row: shows the error inline and does not call startWork when worktree.create fails', async () => {
    ;(window as unknown as { worktree: { create: ReturnType<typeof vi.fn> } }).worktree.create =
      vi.fn().mockResolvedValue({ ok: false, error: 'branch exists' })
    const onCreated = vi.fn()
    render(<WorktreePicker row={unlinkedRow} onClose={vi.fn()} onCreated={onCreated} />)
    await waitFor(() => expect(screen.getByDisplayValue('gero/PROJ-9-fix-the-thing')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /create worktree/i }))

    await waitFor(() => expect(screen.getByText(/branch exists/i)).toBeInTheDocument())
    const tk = (window as unknown as { tickets: { startWork: ReturnType<typeof vi.fn> } }).tickets
    expect(tk.startWork).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('unlinked row: renders a "Run with worker" select listing the available workers', async () => {
    render(<WorktreePicker row={unlinkedRow} onClose={vi.fn()} onOpenWorktree={vi.fn()} />)
    const workerSelect = await screen.findByLabelText('Run with worker')
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Bugfix Bot' })).toBeInTheDocument()
    expect((workerSelect as HTMLSelectElement).value).toBe('') // defaults to None
  })

  it('unlinked row: picking a worker opens the pane with the whole spec (App tracks the pipeline) and steps[0] as the input hint', async () => {
    const onOpenWorktree = vi.fn()
    render(<WorktreePicker row={unlinkedRow} onClose={vi.fn()} onOpenWorktree={onOpenWorktree} />)
    await waitFor(() => expect(screen.getByDisplayValue('gero/PROJ-9-fix-the-thing')).toBeInTheDocument())

    fireEvent.change(await screen.findByLabelText('Run with worker'), { target: { value: 'w1' } })
    fireEvent.click(screen.getByRole('button', { name: /create worktree/i }))

    await waitFor(() => expect(onOpenWorktree).toHaveBeenCalledTimes(1))
    expect(onOpenWorktree).toHaveBeenCalledWith('/tmp/wt', 'Fix the failing test', {
      id: 'w1', name: 'Bugfix Bot',
      steps: [{ agent: 'claude', model: 'haiku', instructions: 'Fix the failing test' }],
      createdAt: 0, updatedAt: 0,
    })
  })

  it('unlinked row: with None selected, opens the pane with undefined input/worker (unchanged flow)', async () => {
    const onOpenWorktree = vi.fn()
    render(<WorktreePicker row={unlinkedRow} onClose={vi.fn()} onOpenWorktree={onOpenWorktree} />)
    await waitFor(() => expect(screen.getByDisplayValue('gero/PROJ-9-fix-the-thing')).toBeInTheDocument())
    await screen.findByLabelText('Run with worker') // workers loaded; None is the default

    fireEvent.click(screen.getByRole('button', { name: /create worktree/i }))

    await waitFor(() => expect(onOpenWorktree).toHaveBeenCalledTimes(1))
    expect(onOpenWorktree).toHaveBeenCalledWith('/tmp/wt', undefined, undefined)
  })

  it('linked row: shows the branch and an Open action; Open calls electronShell.openExternal with the ticket url', async () => {
    render(<WorktreePicker row={linkedRow} onClose={vi.fn()} />)
    expect(screen.getByText('gero/189-race')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create worktree/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^open$/i }))

    const shell = (window as unknown as { electronShell: { openExternal: ReturnType<typeof vi.fn> } }).electronShell
    expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/RAVEN/x/issues/189')
  })
})
