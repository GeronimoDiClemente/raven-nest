// New sidebar tab bar (Worktrees / Explorer / Personal / Tools): when the
// sidebar is expanded, exactly one panel is visible at a time and clicking a
// tab swaps which one. Collapsed-rail behaviour is untouched by this feature
// and isn't exercised here.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Sidebar from '../../components/Sidebar'
import type { UserPreferencesApi } from '../../hooks/useUserPreferences'

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

function renderSidebar() {
  return render(
    <Sidebar
      expanded
      onToggle={() => {}}
      broadcastMode={false}
      onBroadcastToggle={() => {}}
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
    />,
  )
}

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
})
