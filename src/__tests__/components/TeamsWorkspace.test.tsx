import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import TeamsWorkspace from '../../components/TeamsWorkspace'

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
    repos: [],
    loading: false,
    userLocalPaths: {},
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
vi.mock('../../hooks/useTeamChat', () => ({ useTeamChat: () => ({ timeline: [], reactions: {}, loading: false, error: null, postMessage: vi.fn(), deleteMessage: vi.fn(), toggleReaction: vi.fn() }) }))
vi.mock('../../hooks/useTeamsKeyboard', () => ({ useTeamsKeyboard: () => {} }))

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

function renderWorkspace() {
  render(
    <TeamsWorkspace
      onClose={vi.fn()}
      onOpenRepoTerminal={vi.fn()}
    />,
  )
}

describe('TeamsWorkspace nav', () => {
  it('no longer offers the sections that moved to Personal', () => {
    renderWorkspace()
    for (const label of [/^Activity$/, /^Repos$/, /^Issues$/, /^Pendings$/]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
  })

  it('keeps the collaboration sections', () => {
    renderWorkspace()
    for (const label of ['Chat', 'Members', 'Stats', 'Snippets', 'Workspaces', 'MCP Servers']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })
})
