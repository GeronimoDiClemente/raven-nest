import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PersonalWorkspace from '../../components/PersonalWorkspace'
import type { Team, TeamMember, PendingInvite } from '../../hooks/useTeam'
import type { Repo } from '../../hooks/useScopedRepos'

const team = (id: string, name: string): Team => ({ id, name, owner_id: 'u1', created_at: '' })

const repo = (fullName: string): Repo => ({
  id: `r-${fullName}`,
  fullName,
  url: `https://github.com/${fullName}`,
  provider: 'github',
  addedAt: '',
  localPath: null,
  canAdd: true,
})

const leaderMember = (): TeamMember => ({
  id: 'm1', team_id: 't1', user_id: 'u1', email: 'a@b.c', role: 'leader',
  status: 'active', invited_by: 'u1', invited_at: '', accepted_at: null,
  github_login: null,
})

const plainMember = (): TeamMember => ({
  id: 'm1', team_id: 't1', user_id: 'u1', email: 'a@b.c', role: 'member',
  status: 'active', invited_by: 'u1', invited_at: '', accepted_at: null,
  github_login: null,
})

const teamState = {
  teams: [] as Team[],
  activeTeam: null as Team | null,
  members: [] as TeamMember[],
  pendingInvites: [] as PendingInvite[],
  userId: 'u1',
  acceptInvite: vi.fn(async () => {}),
  rejectInvite: vi.fn(async () => {}),
  switchTeam: vi.fn(async () => {}),
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
    teamState.members = []
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

  it('renders each repo fullName from the scoped hook', () => {
    scopedState.repos = [repo('org/repo')]
    render(<PersonalWorkspace {...props} />)
    expect(screen.getByText('org/repo')).toBeInTheDocument()
  })

  it('shows Add repo for a team leader once scoped to that team', () => {
    teamState.teams = [team('t1', 'Nest')]
    teamState.members = [leaderMember()]
    render(<PersonalWorkspace {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Nest' }))
    expect(screen.getByRole('button', { name: 'Add repo' })).toBeInTheDocument()
  })

  it('hides Add repo for a plain team member once scoped to that team', () => {
    teamState.teams = [team('t1', 'Nest')]
    teamState.members = [plainMember()]
    render(<PersonalWorkspace {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Nest' }))
    expect(screen.queryByRole('button', { name: 'Add repo' })).not.toBeInTheDocument()
  })
})
