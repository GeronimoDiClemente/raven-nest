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
    teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue('proj1111aaaaaaaa'),
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

  it('loads settings + branches for the worktree and shows the graph enabled', async () => {
    mockApi()
    render(<TeamThreadPanel activeRepoPath="C:/repo/worktree" onOpenFile={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /open note/i })).toHaveLength(2))
  })

  it('clicking a node opens the note through onOpenFile with the right relative path', async () => {
    const onOpenFile = vi.fn()
    mockApi()
    render(<TeamThreadPanel activeRepoPath="C:/repo/worktree" onOpenFile={onOpenFile} />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /open note/i })).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: /open note for feat\/sidebar-tabs/i }))
    expect(onOpenFile).toHaveBeenCalledWith('.nest/team/ramas/sidebar.md')
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
})
