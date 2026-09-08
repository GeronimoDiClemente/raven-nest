// MyReposPanel's "Run with worker" flow — launches a worker (agent+model+
// instructions, incl. multi-step Hand-off) directly on a linked repo's
// local_path, no board ticket needed. Mirrors WorktreePicker's board-side
// worker-picker tests (src/__tests__/components/WorktreePicker.test.tsx).
// Mocks useUserRepos + useGitlab so nothing touches real IPC/supabase
// (pattern from WorktreePicker.test.tsx / TeamsWorkspace-open-terminal.test.tsx).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PersonalWorkspace from '../../components/PersonalWorkspace'
import type { Repo } from '../../hooks/useScopedRepos'
import type { WorkerSpec } from '../../types'

const repo: Repo = {
  id: 'r1',
  fullName: 'gero/repo1',
  url: 'https://gitlab.com/gero/repo1',
  provider: 'gitlab',
  addedAt: '2026-01-01T00:00:00Z',
  localPath: '/Users/gero/dev/repo1',
}

vi.mock('../../hooks/useScopedRepos', () => ({
  useScopedRepos: () => ({
    repos: [repo],
    canManage: true,
    loading: false,
    refresh: vi.fn(),
    addRepo: vi.fn(),
    updateLocalPath: vi.fn(),
    removeRepo: vi.fn(),
  }),
}))

// gitlabToken truthy (and repo.provider === 'gitlab') satisfies the "connect
// a provider" gate while sidestepping RepoCIBadge/GitHub-only rendering paths.
vi.mock('../../hooks/useGitlab', () => ({
  useGitlab: () => ({
    gitlabLogin: 'gero-gl', gitlabToken: 'gl-tok', isConnected: true, loading: false, error: null,
    connectGitlab: vi.fn(), disconnectGitlab: vi.fn(),
  }),
}))

function makeWorker(over: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    id: 'w1',
    name: 'Bugfix Bot',
    steps: [{ agent: 'claude', model: 'haiku', instructions: 'Fix the failing test' }],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

function renderPanel(onOpenWorktree = vi.fn()) {
  return render(
    <PersonalWorkspace
      onClose={vi.fn()}
      githubToken={null}
      githubLogin={null}
      onConnectGitHub={vi.fn()}
      onOpenRepoTerminal={vi.fn()}
      onOpenTeamWorkspace={vi.fn()}
      allowTeam={false}
      activeRepoPath={null}
      focusedPaneId={null}
      onOpenWorktree={onOpenWorktree}
    />,
  )
}

async function openWorkerPicker() {
  fireEvent.click(await screen.findByTitle('More actions'))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Run with worker' }))
}

describe('PersonalWorkspace — Run with worker', () => {
  beforeEach(() => {
    window.workerSpecs = {
      list: vi.fn().mockResolvedValue([makeWorker()]),
      save: vi.fn(),
      delete: vi.fn(),
    } as never
  })

  it('lists the worker in the picker; clicking it calls onOpenWorktree with (local_path, steps[0].instructions, spec) and closes the picker', async () => {
    const onOpenWorktree = vi.fn()
    renderPanel(onOpenWorktree)

    await openWorkerPicker()

    expect(await screen.findByText('Bugfix Bot')).toBeInTheDocument()
    expect(screen.getByText('claude:haiku')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Bugfix Bot'))

    expect(onOpenWorktree).toHaveBeenCalledTimes(1)
    expect(onOpenWorktree).toHaveBeenCalledWith('/Users/gero/dev/repo1', 'Fix the failing test', makeWorker())

    await waitFor(() => expect(screen.queryByText('Bugfix Bot')).not.toBeInTheDocument())
  })

  it('shows an empty-state hint when there are no workers yet', async () => {
    window.workerSpecs.list = vi.fn().mockResolvedValue([])
    renderPanel()

    await openWorkerPicker()

    expect(await screen.findByText(/No workers yet — create one in Integrations → Automations\./)).toBeInTheDocument()
  })
})
