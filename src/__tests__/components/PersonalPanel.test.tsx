// The Personal tab used to be two rows that opened panels. Now it previews
// what's behind them: the team's members and the user's repos.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PersonalPanel from '../../components/PersonalPanel'
import type { Team, TeamMember, PendingInvite } from '../../hooks/useTeam'
import type { UserRepo } from '../../hooks/useUserRepos'

const team: Team = { id: 't1', name: 'Nest', owner_id: 'u1', created_at: '' }

function member(email: string, extra: Partial<TeamMember> = {}): TeamMember {
  return {
    id: `m-${email}`, team_id: 't1', user_id: 'u', email, role: 'member',
    status: 'active', invited_by: 'u1', invited_at: '', accepted_at: '',
    github_login: null, ...extra,
  }
}

function repo(name: string, localPath: string | null = null): UserRepo {
  return {
    id: `r-${name}`, user_id: 'u1', repo_full_name: name,
    repo_url: `https://github.com/${name}`, added_at: '', local_path: localPath,
    provider: 'github',
  }
}

const teamState = {
  teams: [] as Team[],
  activeTeam: null as Team | null,
  members: [] as TeamMember[],
  pendingInvites: [] as PendingInvite[],
}
const reposState = { repos: [] as UserRepo[] }

vi.mock('../../hooks/useTeam', () => ({ useTeam: () => teamState }))
vi.mock('../../hooks/useUserRepos', () => ({ useUserRepos: () => reposState }))

describe('PersonalPanel', () => {
  beforeEach(() => {
    teamState.teams = []
    teamState.activeTeam = null
    teamState.members = []
    teamState.pendingInvites = []
    reposState.repos = [repo('gero/raven-nest', 'C:/dev/raven-nest'), repo('gero/voxia')]
  })

  // Gero's call: a solo user shouldn't see an empty Team section staring at them.
  it('shows only the repos section when the user has no teams', () => {
    render(<PersonalPanel />)
    expect(screen.queryByText('TEAM')).not.toBeInTheDocument()
    expect(screen.getByText('REPOS')).toBeInTheDocument()
    expect(screen.getByText('gero/raven-nest')).toBeInTheDocument()
  })

  it('says REPOS, not My Repos', () => {
    render(<PersonalPanel />)
    expect(screen.queryByText(/My Repos/i)).not.toBeInTheDocument()
  })

  it('shows the active team with its members when there is one', () => {
    teamState.teams = [team]
    teamState.activeTeam = team
    teamState.members = [member('gero@nest.dev'), member('bauti@nest.dev', { github_login: 'bauti' })]
    render(<PersonalPanel />)
    expect(screen.getByText('TEAM')).toBeInTheDocument()
    expect(screen.getByText('Nest')).toBeInTheDocument()
    expect(screen.getByText('gero')).toBeInTheDocument()   // local part of the email
    expect(screen.getByText('bauti')).toBeInTheDocument()  // github_login wins
  })

  it('caps the member list and counts the rest', () => {
    teamState.teams = [team]
    teamState.activeTeam = team
    teamState.members = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(n => member(`${n}@nest.dev`))
    render(<PersonalPanel />)
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.queryByText('h')).not.toBeInTheDocument()
    expect(screen.getByText('+2 more')).toBeInTheDocument()
  })

  it('puts pending invites first, since they are the actionable bit', () => {
    teamState.teams = [team]
    teamState.activeTeam = team
    teamState.pendingInvites = [{ memberId: 'm1', team, invitedAt: '' }]
    render(<PersonalPanel />)
    expect(screen.getByText(/1 pending invite/)).toBeInTheDocument()
  })

  it('opens the full panels on click', () => {
    const onTeamsOpen = vi.fn()
    const onReposOpen = vi.fn()
    teamState.teams = [team]
    teamState.activeTeam = team
    teamState.members = [member('gero@nest.dev')]
    render(<PersonalPanel onTeamsOpen={onTeamsOpen} onReposOpen={onReposOpen} />)
    fireEvent.click(screen.getByText('gero'))
    expect(onTeamsOpen).toHaveBeenCalled()
    fireEvent.click(screen.getByText('gero/voxia'))
    expect(onReposOpen).toHaveBeenCalled()
  })

  it('marks which repos are cloned on this machine', () => {
    render(<PersonalPanel />)
    const cloned = screen.getByText('gero/raven-nest').closest('button')
    const notCloned = screen.getByText('gero/voxia').closest('button')
    expect(cloned).toHaveTextContent('local')
    expect(notCloned).not.toHaveTextContent('local')
  })

  it('tells a free user where the repos list lives', () => {
    reposState.repos = []
    render(<PersonalPanel plan="free" />)
    expect(screen.getByText('Pro')).toBeInTheDocument()
  })
})
