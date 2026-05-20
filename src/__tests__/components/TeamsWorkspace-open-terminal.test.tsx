import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TeamsWorkspace from '../../components/TeamsWorkspace'

const teamRepo = {
  id: 'tr-1',
  team_id: 't-1',
  repo_full_name: 'org/repo',
  repo_url: 'https://github.com/org/repo',
  added_by: 'u-1',
  added_at: '2026-05-20T00:00:00Z',
  provider: 'github' as const,
  local_path: null,
}

vi.mock('../../hooks/useTeam', () => ({
  useTeam: () => ({
    teams: [{ id: 't-1', name: 'T', owner_id: 'u-1', created_at: '' }],
    activeTeam: { id: 't-1', name: 'T', owner_id: 'u-1', created_at: '' },
    members: [{ id: 'm-1', team_id: 't-1', user_id: 'u-1', email: 'a@b.c', role: 'leader', status: 'active', invited_by: 'u-1', invited_at: '', accepted_at: null }],
    pendingInvites: [], myPendingRequests: [], loading: false, userId: 'u-1',
    switchTeam: vi.fn(), createTeam: vi.fn(), inviteMember: vi.fn(), removeMember: vi.fn(),
    promoteMember: vi.fn(), demoteMember: vi.fn(),
    acceptInvite: vi.fn(), rejectInvite: vi.fn(),
    requestJoin: vi.fn(), cancelRequest: vi.fn(), approveRequest: vi.fn(), declineRequest: vi.fn(),
    leaveTeam: vi.fn(), deleteTeam: vi.fn(), refresh: vi.fn(),
  }),
}))

vi.mock('../../hooks/useTeamRepos', () => ({
  useTeamRepos: () => ({
    repos: [teamRepo],
    loading: false,
    userLocalPaths: { 'tr-1': 'C:/dev/repo' },
    refresh: vi.fn(),
    addRepo: vi.fn(),
    updateUserLocalPath: vi.fn(),
    removeRepo: vi.fn(),
    setPermission: vi.fn(),
  }),
}))

vi.mock('../../hooks/useTeamPresence', () => ({ useTeamPresence: () => ({ presence: {} }) }))
vi.mock('../../hooks/useSharedSnippets', () => ({ useSharedSnippets: () => ({ items: [], loading: false, userId: 'u-1', refresh: vi.fn(), remove: vi.fn() }) }))
vi.mock('../../hooks/useSharedWorkspaces', () => ({ useSharedWorkspaces: () => ({ items: [], loading: false, userId: 'u-1', refresh: vi.fn(), remove: vi.fn() }) }))
vi.mock('../../hooks/useSharedMcpConfigs', () => ({ useSharedMcpConfigs: () => ({ items: [], loading: false, userId: 'u-1', refresh: vi.fn(), remove: vi.fn() }) }))
vi.mock('../../hooks/useGitHub', () => ({ useGitHub: () => ({ githubLogin: 'me', githubToken: 't', isConnected: true, connectGitHub: vi.fn() }) }))
vi.mock('../../hooks/useGitlab', () => ({ useGitlab: () => ({ gitlabLogin: null, gitlabToken: null, isConnected: false, connectGitlab: vi.fn() }) }))
vi.mock('../../hooks/useGitHubNotifications', () => ({ useGitHubNotifications: () => ({ notifications: [], unreadCount: 0, markAsRead: vi.fn() }) }))
vi.mock('../../hooks/useTeamChat', () => ({ useTeamChat: () => ({}) }))
vi.mock('../../hooks/useTeamsKeyboard', () => ({ useTeamsKeyboard: () => {} }))

// ProviderAvatar is referenced in the Clone/Link dialog but not exported from ProviderAvatar.tsx.
// Mock the module to provide all names the component uses.
vi.mock('../../components/ProviderAvatar', () => ({
  ProviderAvatarPill: () => null,
  ProviderIcon: () => null,
  ProviderAvatar: () => null,
}))

// Prevent supabase from requiring real env vars (transitive via TeamJoinCodePanel → useTeamJoinCode)
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() })),
    auth: { getUser: vi.fn(), onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) },
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
  },
}))

describe('TeamsWorkspace.handleOpenTerminal regression', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: Window }).window.pathUtils = { exists: vi.fn().mockResolvedValue(true) } as never
    ;(globalThis as unknown as { window: Window }).window.git = {
      getRemoteUrl: vi.fn().mockRejectedValue(new Error('git missing')),
    } as never
  })

  it('opens the Clone/Link dialog when getRemoteUrl throws (does not crash)', async () => {
    const onOpenRepoTerminal = vi.fn()
    render(
      <TeamsWorkspace
        onClose={vi.fn()}
        onOpenRepoTerminal={onOpenRepoTerminal}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /repos/i }))
    const terminalBtns = await screen.findAllByRole('button', { name: /terminal/i })
    // Pick the repo-action "Open terminal" button (not the bottom panel toggle)
    const terminalBtn = terminalBtns.find(b => b.classList.contains('repo-action-btn')) ?? terminalBtns[0]
    fireEvent.click(terminalBtn)
    await waitFor(() => {
      expect(screen.getByText('org/repo')).toBeInTheDocument()
    })
    expect(onOpenRepoTerminal).not.toHaveBeenCalled()
  })
})
