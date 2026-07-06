// Task E: la sección "Integrations" de Teams muestra el pitch de
// Team · Enterprise (antes un tab dentro del marketplace embebido en My
// Repos, ahora separado en su propia vista/sección). Reusa el setup de
// mocks de TeamsWorkspace-open-terminal.test.tsx.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

describe('TeamsWorkspace — sección Integrations', () => {
  it('el nav muestra "Integrations" y clickearlo renderiza el pitch de Team · Enterprise', async () => {
    render(
      <TeamsWorkspace
        onClose={vi.fn()}
        onOpenRepoTerminal={vi.fn()}
      />,
    )
    const integrationsBtn = await screen.findByRole('button', { name: /^integrations$/i })
    fireEvent.click(integrationsBtn)
    expect(await screen.findByText('Custom integrations for your team')).toBeInTheDocument()
    expect(screen.getByText('We build them to spec.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Contact Enterprise' })).toBeInTheDocument()
    // No debe traer el marketplace personal a esta sección.
    expect(screen.queryByPlaceholderText('Search...')).not.toBeInTheDocument()
  })
})
