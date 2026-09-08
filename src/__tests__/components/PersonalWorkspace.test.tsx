import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import PersonalWorkspace from '../../components/PersonalWorkspace'
import type { Team, TeamMember, PendingInvite } from '../../hooks/useTeam'
import type { Repo } from '../../hooks/useScopedRepos'

const team = (id: string, name: string): Team => ({ id, name, owner_id: 'u1', created_at: '' })

const teamState = {
  teams: [] as Team[],
  activeTeam: null as Team | null,
  members: [] as TeamMember[],
  pendingInvites: [] as PendingInvite[],
  userId: 'u1',
  acceptInvite: vi.fn(async () => {}),
  rejectInvite: vi.fn(async () => {}),
}
const scopedState = {
  repos: [] as Repo[],
  loading: false,
  refresh: vi.fn(async () => {}),
  addRepo: vi.fn(async () => true),
  updateLocalPath: vi.fn(async () => {}),
  removeRepo: vi.fn(async () => {}),
}

vi.mock('../../hooks/useTeam', () => ({ useTeam: () => teamState }))
vi.mock('../../hooks/useScopedRepos', () => ({ useScopedRepos: () => scopedState }))
vi.mock('../../hooks/useGitHubNotifications', () => ({
  useGitHubNotifications: () => ({ notifications: [], unreadCount: 0, markAsRead: vi.fn() }),
}))
vi.mock('../../hooks/useGitlab', () => ({ useGitlab: () => ({ gitlabLogin: null, gitlabToken: null }) }))

const props = {
  onClose: vi.fn(),
  githubToken: 'gh-token',
  githubLogin: 'gero',
  onConnectGitHub: vi.fn(),
  onOpenRepoTerminal: vi.fn(),
  onOpenTeamWorkspace: vi.fn(),
  allowTeam: true,
}

describe('PersonalWorkspace', () => {
  beforeEach(() => {
    teamState.teams = []
    teamState.pendingInvites = []
    scopedState.repos = []
  })

  it('is titled Personal, not My Repos', () => {
    render(<PersonalWorkspace {...props} />)
    expect(screen.getByText('Personal')).toBeInTheDocument()
    expect(screen.queryByText('My Repos')).not.toBeInTheDocument()
  })

  it('hides the scope selector for a user with no teams', () => {
    render(<PersonalWorkspace {...props} />)
    expect(screen.queryByRole('button', { name: 'Nest' })).not.toBeInTheDocument()
  })

  it('shows the scope selector once the user belongs to a team', () => {
    teamState.teams = [team('t1', 'Nest')]
    render(<PersonalWorkspace {...props} />)
    expect(screen.getByRole('button', { name: 'Nest' })).toBeInTheDocument()
  })

  it('hides the scope selector when the plan has no teams', () => {
    teamState.teams = [team('t1', 'Nest')]
    render(<PersonalWorkspace {...props} allowTeam={false} />)
    expect(screen.queryByRole('button', { name: 'Nest' })).not.toBeInTheDocument()
  })
})
