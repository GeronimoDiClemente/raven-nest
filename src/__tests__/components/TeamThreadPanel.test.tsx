import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TeamThreadPanel from '../../components/TeamThreadPanel'
import type { TeamThreadBranch, TeamThreadSettings } from '../../types'

const BRANCHES: TeamThreadBranch[] = [
  { slug: 'sidebar', branch: 'feat/sidebar-tabs', estado: 'activa', ultimoAutor: 'Bauti', ultimaEntrada: Date.now() - 3600_000, entradas: 2 },
  { slug: 'bridge', branch: 'smoke/memory-bridge', estado: 'cerrada', ultimoAutor: 'Gero', ultimaEntrada: Date.now() - 40 * 86400_000, entradas: 5 },
]

function mockApi(overrides: {
  settings?: TeamThreadSettings
  branches?: TeamThreadBranch[]
  gitBranch?: string | null
  setSettings?: ReturnType<typeof vi.fn>
} = {}) {
  const settings: TeamThreadSettings = overrides.settings ?? { enabled: true, includedTypes: ['handoff', 'decision'], writeAgentsPointer: true }
  const memoryApi = {
    teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: true, projectKey: 'proj1111aaaaaaaa' }),
    teamThreadGetSettings: vi.fn().mockResolvedValue({ ok: true, settings }),
    teamThreadRead: vi.fn().mockResolvedValue({ ok: true, branches: overrides.branches ?? BRANCHES }),
    teamThreadSetSettings:
      overrides.setSettings ?? vi.fn().mockResolvedValue({ ok: true, settings: { ...settings, enabled: !settings.enabled } }),
  }
  const gitApi = { info: vi.fn().mockResolvedValue({ branch: overrides.gitBranch ?? 'feat/sidebar-tabs', remoteUrl: null, githubUrl: null, isDirty: false }) }
  ;(window as unknown as { memory: typeof memoryApi }).memory = memoryApi
  ;(window as unknown as { git: typeof gitApi }).git = gitApi
  return { memoryApi, gitApi }
}

describe('TeamThreadPanel', () => {
  afterEach(() => {
    delete (window as unknown as { memory?: unknown }).memory
    delete (window as unknown as { git?: unknown }).git
  })

  it('renders nothing without an active worktree', () => {
    mockApi()
    const { container } = render(<TeamThreadPanel activeRepoPath={null} onOpenFile={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('loads settings + branches for the worktree and shows the graph enabled, focused on the current branch (global by default, I5)', async () => {
    mockApi()
    render(<TeamThreadPanel activeRepoPath="C:/repo/worktree" onOpenFile={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /open note/i })).toHaveLength(2))
    expect(screen.getByRole('button', { name: /open note for feat\/sidebar-tabs/i })).toBeInTheDocument()

    fireEvent.click(screen.getByText('Show current branch'))
    expect(screen.getAllByRole('button', { name: /open note/i })).toHaveLength(1)
  })

  it('clicking a node opens the note through onOpenFile with the right relative path', async () => {
    const onOpenFile = vi.fn()
    mockApi()
    render(<TeamThreadPanel activeRepoPath="C:/repo/worktree" onOpenFile={onOpenFile} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /open note for feat\/sidebar-tabs/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /open note for feat\/sidebar-tabs/i }))
    expect(onOpenFile).toHaveBeenCalledWith('.nest/team/ramas/sidebar.md')
  })

  it('I2: the general node opens general.md at the thread root, not ramas/general.md', async () => {
    const onOpenFile = vi.fn()
    mockApi({
      branches: [{ slug: 'general', branch: 'general', estado: 'sin-worktree', ultimoAutor: 'Gero', ultimaEntrada: Date.now(), entradas: 1 }],
      gitBranch: null,
    })
    render(<TeamThreadPanel activeRepoPath="C:/repo/worktree" onOpenFile={onOpenFile} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /open note for general/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /open note for general/i }))
    expect(onOpenFile).toHaveBeenCalledWith('.nest/team/general.md')
  })

  it('I1: a plan that cannot share shows the actionable message, not the generic one', async () => {
    const setSettings = vi.fn().mockResolvedValue({
      ok: false,
      error: 'team_plan_required',
      message: 'Sharing this thread needs a Team plan. Upgrade the account, then turn it on again.',
    })
    mockApi({ settings: { enabled: false, includedTypes: ['handoff', 'decision'], writeAgentsPointer: true }, setSettings })
    render(<TeamThreadPanel activeRepoPath="C:/repo/worktree" onOpenFile={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/share this project's thread/i)).toBeInTheDocument())

    fireEvent.click(screen.getByText('Turn on'))
    await waitFor(() => expect(screen.getByText(/needs a team plan/i)).toBeInTheDocument())
  })

  it('shows the off state when disabled and turning it on calls teamThreadSetSettings', async () => {
    const setSettings = vi.fn().mockResolvedValue({
      ok: true,
      settings: { enabled: true, includedTypes: ['handoff', 'decision'], writeAgentsPointer: true },
    })
    mockApi({ settings: { enabled: false, includedTypes: ['handoff', 'decision'], writeAgentsPointer: true }, setSettings })
    render(<TeamThreadPanel activeRepoPath="C:/repo/worktree" onOpenFile={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/share this project's thread/i)).toBeInTheDocument())

    fireEvent.click(screen.getByText('Turn on'))
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith('proj1111aaaaaaaa', 'C:/repo/worktree', { enabled: true }))
  })

  it('shows a visible error (not a silent blank panel) when the initial load fails', async () => {
    const { memoryApi } = mockApi()
    memoryApi.teamThreadGetSettings.mockResolvedValue({ ok: false, error: 'memory_unavailable' })
    render(<TeamThreadPanel activeRepoPath="C:/repo/worktree" onOpenFile={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/couldn't load the team thread/i)).toBeInTheDocument())
    expect(screen.queryAllByRole('button', { name: /open note/i })).toHaveLength(0)
  })

  it('shows a visible error (not a silent blank panel) when the IPC call rejects outright', async () => {
    const { memoryApi } = mockApi()
    memoryApi.teamThreadProjectKeyForWorktree.mockRejectedValue(new Error('ipc down'))
    render(<TeamThreadPanel activeRepoPath="C:/repo/worktree" onOpenFile={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/couldn't load the team thread/i)).toBeInTheDocument())
  })

  it('a failed toggle shows an inline error but keeps the already-loaded graph visible', async () => {
    const setSettings = vi.fn().mockResolvedValue({ ok: false, error: 'memory_unavailable' })
    mockApi({ setSettings })
    render(<TeamThreadPanel activeRepoPath="C:/repo/worktree" onOpenFile={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /open note for feat\/sidebar-tabs/i })).toBeInTheDocument())

    fireEvent.click(screen.getByText('Turn off'))
    await waitFor(() => expect(screen.getByText(/couldn't update the team thread setting/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /open note for feat\/sidebar-tabs/i })).toBeInTheDocument()
  })
})
