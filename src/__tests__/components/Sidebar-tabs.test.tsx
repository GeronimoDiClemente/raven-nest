// New sidebar tab bar (Worktrees / Explorer / Tools): when the sidebar is
// expanded, exactly one panel is visible at a time and clicking a tab swaps
// which one. Personal is not a tab — it's a single row in the footer, above
// the user menu, covered separately below.
// Collapsed-rail behaviour is untouched by this feature and isn't exercised
// here.
import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Sidebar from '../../components/Sidebar'
import type { UserPreferencesApi } from '../../hooks/useUserPreferences'

vi.mock('../../hooks/useGitInfo', () => ({ useGitInfo: () => ({ branch: 'pre-produccion', githubUrl: null, isDirty: false }) }))
vi.mock('../../hooks/useGitHub', () => ({ useGitHub: () => ({ githubToken: null, githubLogin: null, isConnected: false, loading: false, error: null, connectGitHub: vi.fn(), disconnectGitHub: vi.fn() }) }))
vi.mock('../../hooks/useGitlab', () => ({ useGitlab: () => ({ gitlabToken: null, gitlabLogin: null, isConnected: false, loading: false, error: null, connectGitlab: vi.fn(), disconnectGitlab: vi.fn() }) }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}))

function userPrefs(): UserPreferencesApi {
  return {
    prefs: { active_team_id: null, ui_settings: {} },
    loaded: true,
    setActiveTeam: vi.fn(),
    setFontSize: vi.fn(),
    setEditorOptions: vi.fn(),
    setEditorTheme: vi.fn(),
  }
}

function renderSidebar(extra: Partial<ComponentProps<typeof Sidebar>> = {}) {
  return render(
    <Sidebar
      expanded
      onToggle={() => {}}
      broadcastMode={false}
      onBroadcastToggle={() => {}}
      onFixCi={() => {}}
      isListening={false}
      isTranscribing={false}
      isModelLoading={false}
      onMicToggle={() => {}}
      onNewPane={() => {}}
      onHistoryOpen={() => {}}
      onSnippetSend={() => {}}
      onSnippetBroadcast={() => {}}
      onWorkspaceSave={() => {}}
      onWorkspaceLoad={() => {}}
      isWin={false}
      onRepoLink={() => {}}
      onRepoUnlink={() => {}}
      onJoinTerminal={() => {}}
      onWorktreeSelect={() => {}}
      onNewWorktree={() => {}}
      layoutId="1"
      paneCount={1}
      onLayoutChange={() => {}}
      onFileOpen={() => {}}
      userPrefs={userPrefs()}
      {...extra}
    />,
  )
}

const hubProps: Partial<ComponentProps<typeof Sidebar>> = {
  isHub: true,
  hubWorkspaces: [],
  onSelectWorkspace: () => {},
  onJumpToPane: () => {},
  onToggleTerminal: () => {},
  onToggleWorkspace: () => {},
  onNewWorkspace: () => {},
  onAddTerminalToWorkspace: () => {},
} as const

describe('Sidebar tabs', () => {
  beforeEach(() => {
    Object.assign(window as unknown as Record<string, unknown>, {
      updater: { checkForUpdates: vi.fn() },
      // WorktreesSection's spotlight-status effect runs on mount regardless
      // of repoPath (hooks can't be conditional), so these are needed even
      // though this test renders with no repo linked.
      worktree: { list: vi.fn(async () => ({ ok: true, worktrees: [] })), remove: vi.fn(async () => {}) },
      git: { shortstat: vi.fn(async () => ({ additions: 0, deletions: 0, filesChanged: 0 })), findPRForBranch: vi.fn(async () => null) },
      spotlight: { status: vi.fn(async () => ({ active: false })), onStatus: vi.fn(), start: vi.fn(async () => {}), stop: vi.fn(async () => {}), removeListeners: vi.fn() },
      preset: { onSetupState: vi.fn(), cancel: vi.fn(async () => {}), removeListeners: vi.fn() },
      electronShell: { openExternal: vi.fn() },
      // The Tools tab mounts the panels, which fetch on mount.
      snippets: { list: vi.fn(async () => []) },
      commandHistory: { list: vi.fn(async () => []) },
      workspaces: { list: vi.fn(async () => []) },
      mcp: { list: vi.fn(async () => []) },
    })
  })

  it('defaults to the Worktrees tab and hides the others', () => {
    renderSidebar()
    expect(screen.getByRole('tab', { name: /Worktrees/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText(/No folder open/i)).not.toBeInTheDocument()
  })

  it('shows the Explorer panel and hides Worktrees after clicking the Explorer tab', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('tab', { name: /Explorer/ }))
    expect(screen.getByRole('tab', { name: /Explorer/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Worktrees/ })).toHaveAttribute('aria-selected', 'false')
  })

  // The repo name is the menu's title, not a block above it: it sits inside
  // the same box as the tabs, so it stays visible on every tab.
  it('puts the repo name inside the menu box, in the same box as the tabs', () => {
    const { container } = renderSidebar({ repoPath: '/home/gero/app-script-lan' })
    const box = container.querySelector('.sidebar-menu-box')
    expect(box).not.toBeNull()
    expect(box).toHaveTextContent('app-script-lan')
    expect(box!.querySelector('.sidebar-tabbar')).not.toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /Tools/ }))
    expect(container.querySelector('.sidebar-menu-box')).toHaveTextContent('app-script-lan')
  })

  // Branch and CI only mean something next to the worktrees, so they moved
  // into that tab instead of taking room on every one.
  it('shows the branch only inside the Worktrees tab', () => {
    const { container } = renderSidebar({ repoPath: '/home/gero/app-script-lan' })
    expect(screen.getByText(/pre-produccion/)).toBeInTheDocument()
    expect(container.querySelector('.sidebar-menu-box')).not.toHaveTextContent('pre-produccion')

    fireEvent.click(screen.getByRole('tab', { name: /Explorer/ }))
    expect(screen.queryByText(/pre-produccion/)).not.toBeInTheDocument()
  })

  it('swaps Worktrees for Hub in Hub mode', () => {
    renderSidebar(hubProps)
    expect(screen.getByRole('tab', { name: /Hub/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Explorer/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Tools/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Worktrees/ })).not.toBeInTheDocument()
  })

  // The Personal row lives outside the tabs entirely (in the footer, above
  // the user menu), so it stays put across tab switches and Hub/repo modes —
  // this is what gives the Hub sidebar and the repo sidebar the same shape.
  it('keeps Personal reachable in Hub mode regardless of the active tab', () => {
    renderSidebar(hubProps)
    expect(screen.getByTitle(/^Personal/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Tools' }))
    expect(screen.getByTitle(/^Personal/)).toBeInTheDocument()
  })

  it('shows three tabs, without Personal', () => {
    renderSidebar()
    expect(screen.getByRole('tab', { name: 'Worktrees' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Explorer' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Personal' })).not.toBeInTheDocument()
  })

  it('puts a single Personal row above the user menu', () => {
    renderSidebar()
    expect(screen.getByTitle(/^Personal/)).toBeInTheDocument()
    expect(screen.queryByText('Team')).not.toBeInTheDocument()
    expect(screen.queryByText('Repos')).not.toBeInTheDocument()
  })

  it('badges the Personal row with the pending invite count', () => {
    renderSidebar({ pendingInvitesCount: 3 })
    expect(screen.getByLabelText('3 pending invites')).toBeInTheDocument()
  })

  it('sends Free users to the upgrade modal instead of Personal', () => {
    const onUpgrade = vi.fn()
    const onPersonalOpen = vi.fn()
    renderSidebar({ plan: 'free', onUpgrade, onPersonalOpen })
    fireEvent.click(screen.getByTitle(/^Personal/))
    expect(onUpgrade).toHaveBeenCalled()
    expect(onPersonalOpen).not.toHaveBeenCalled()
  })
})
