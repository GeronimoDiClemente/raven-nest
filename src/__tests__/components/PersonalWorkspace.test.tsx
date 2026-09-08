import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PersonalWorkspace from '../../components/PersonalWorkspace'
import type { Team, TeamMember, PendingInvite } from '../../hooks/useTeam'
import type { Repo, RepoScope } from '../../hooks/useScopedRepos'

const team = (id: string, name: string): Team => ({ id, name, owner_id: 'u1', created_at: '' })

const repo = (fullName: string): Repo => ({
  id: `r-${fullName}`,
  fullName,
  url: `https://github.com/${fullName}`,
  provider: 'github',
  addedAt: '',
  localPath: null,
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
  acceptInvite: vi.fn(async () => ({ ok: true })),
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
// The stand-in mirrors the real hook's one permission rule so these tests can
// drive it the way the product does — through the team roster. The rule itself
// is owned and tested by useScopedRepos.test.tsx.
vi.mock('../../hooks/useScopedRepos', () => ({
  useScopedRepos: (scope: RepoScope, isTeamLeader = false) => ({
    ...scopedState,
    canManage: scope.kind !== 'team' || isTeamLeader,
  }),
}))
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

  it('hides the scope chips for a user with no teams', () => {
    render(<PersonalWorkspace {...props} />)
    expect(screen.queryByRole('button', { name: 'Nest' })).not.toBeInTheDocument()
  })

  // The team workspace's "Welcome to Teams" empty state (create a team, join by
  // code) used to be reachable through the sidebar's Team door, which this
  // branch deleted. Personal is the only remaining way in, so a user with zero
  // teams and no pending invitation needs one here or they can never get a
  // first team.
  it('lets a user with zero teams reach the create/join team surface', () => {
    teamState.teams = []
    const onOpenTeamWorkspace = vi.fn()
    render(<PersonalWorkspace {...props} onOpenTeamWorkspace={onOpenTeamWorkspace} />)
    fireEvent.click(screen.getByRole('button', { name: /create or join a team/i }))
    expect(onOpenTeamWorkspace).toHaveBeenCalled()
  })

  it('does not offer create/join on a plan without teams', () => {
    teamState.teams = []
    render(<PersonalWorkspace {...props} allowTeam={false} />)
    expect(screen.queryByRole('button', { name: /create or join a team/i })).not.toBeInTheDocument()
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

  it('makes the picked team the active team when scoping to it', () => {
    teamState.teams = [team('t1', 'Nest')]
    render(<PersonalWorkspace {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Nest' }))
    expect(teamState.switchTeam).toHaveBeenCalledWith('t1')
  })

  // Without this, someone in no team at all cannot accept the invite that would
  // put them in one: the Team door is gone from the sidebar.
  it('lets a user with zero teams reach their pending invites', () => {
    teamState.teams = []
    teamState.pendingInvites = [{
      memberId: 'm1', team: team('t9', 'Nest'), invitedAt: '2026-09-08',
    }]
    render(<PersonalWorkspace {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /invites/i }))
    expect(screen.getByText('Nest')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument()
  })

  it('shows the invite count on the nav item', () => {
    teamState.pendingInvites = [
      { memberId: 'm1', team: team('t9', 'Nest'), invitedAt: '' },
      { memberId: 'm2', team: team('t8', 'STI'), invitedAt: '' },
    ]
    render(<PersonalWorkspace {...props} />)
    expect(screen.getByRole('button', { name: /invites/i })).toHaveTextContent('2')
  })

  // The sidebar badge for pending invites lives outside Personal (a separate
  // usePendingInvitesCount hook in App). Without this callback firing, that
  // badge keeps advertising an invite the user already accepted here.
  it('notifies the caller after accepting an invite', async () => {
    teamState.pendingInvites = [{ memberId: 'm1', team: team('t9', 'Nest'), invitedAt: '' }]
    const onPendingInvitesChange = vi.fn()
    render(<PersonalWorkspace {...props} onPendingInvitesChange={onPendingInvitesChange} />)
    fireEvent.click(screen.getByRole('button', { name: /invites/i }))
    fireEvent.click(screen.getByRole('button', { name: /accept/i }))
    await waitFor(() => expect(onPendingInvitesChange).toHaveBeenCalled())
  })

  it('notifies the caller after declining an invite', async () => {
    teamState.pendingInvites = [{ memberId: 'm1', team: team('t9', 'Nest'), invitedAt: '' }]
    const onPendingInvitesChange = vi.fn()
    render(<PersonalWorkspace {...props} onPendingInvitesChange={onPendingInvitesChange} />)
    fireEvent.click(screen.getByRole('button', { name: /invites/i }))
    fireEvent.click(screen.getByRole('button', { name: /decline/i }))
    await waitFor(() => expect(onPendingInvitesChange).toHaveBeenCalled())
  })

  // Regression coverage for the getRemoteUrl guard in handleOpenTerminal
  // (this logic moved here from TeamsWorkspace along with the Repos section;
  // its own regression test did not move with it — see task-6-report.md).
  // In PERSONAL scope a getRemoteUrl failure stays non-fatal: it's your own
  // path, so the terminal opens anyway rather than nagging. This is
  // long-standing behaviour, unrelated to the team-scope rule below.
  it('opens the terminal even when getRemoteUrl throws in personal scope', async () => {
    scopedState.repos = [{ ...repo('org/repo'), localPath: 'C:/dev/repo' }]
    ;(globalThis as unknown as { window: Window }).window.pathUtils = {
      exists: vi.fn().mockResolvedValue(true),
    } as never
    ;(globalThis as unknown as { window: Window }).window.git = {
      getRemoteUrl: vi.fn().mockRejectedValue(new Error('git missing')),
    } as never
    const onOpenRepoTerminal = vi.fn()
    render(<PersonalWorkspace {...props} onOpenRepoTerminal={onOpenRepoTerminal} />)
    fireEvent.click(screen.getByRole('button', { name: /terminal/i }))
    await waitFor(() => {
      expect(onOpenRepoTerminal).toHaveBeenCalledWith('org/repo', 'C:/dev/repo')
    })
  })

  // In team scope "Remove from list" deletes the row for the whole team. The
  // surface this replaced only offered it to leaders; here it was offered to
  // everyone, so any member could delete a team's repo for all of them.
  it('does not offer removing a team repo to a plain member', () => {
    teamState.teams = [team('t1', 'Nest')]
    teamState.members = [plainMember()]
    scopedState.repos = [repo('org/repo')]
    render(<PersonalWorkspace {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Nest' }))
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
    expect(screen.queryByRole('menuitem', { name: /remove/i })).not.toBeInTheDocument()
  })

  // …and the copy has to stop pretending the row is only yours.
  it('tells a team leader that removing hits the whole team', () => {
    teamState.teams = [team('t1', 'Nest')]
    teamState.members = [leaderMember()]
    scopedState.repos = [repo('org/repo')]
    render(<PersonalWorkspace {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Nest' }))
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from team' }))
    expect(screen.getByText(/every member loses access/i)).toBeInTheDocument()
  })

  it('keeps the personal wording in personal scope', () => {
    scopedState.repos = [repo('org/repo')]
    render(<PersonalWorkspace {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from list' }))
    expect(screen.getByText(/from your list/i)).toBeInTheDocument()
  })

  // Team scope is the opposite: the remote check is what catches a stale local
  // path pointing at a DIFFERENT repo, and team paths are per-device for repos
  // other people added. Silently opening the wrong repo's folder is exactly the
  // failure the check exists to prevent, so a throw has to surface Clone/Link
  // (as the team surface this replaced did).
  it('asks instead of guessing when getRemoteUrl throws in team scope', async () => {
    teamState.teams = [team('t1', 'Nest')]
    teamState.members = [leaderMember()]
    scopedState.repos = [{ ...repo('org/repo'), localPath: 'C:/dev/repo' }]
    ;(globalThis as unknown as { window: Window }).window.pathUtils = {
      exists: vi.fn().mockResolvedValue(true),
    } as never
    ;(globalThis as unknown as { window: Window }).window.git = {
      getRemoteUrl: vi.fn().mockRejectedValue(new Error('git missing')),
    } as never
    const onOpenRepoTerminal = vi.fn()
    render(<PersonalWorkspace {...props} onOpenRepoTerminal={onOpenRepoTerminal} />)
    fireEvent.click(screen.getByRole('button', { name: 'Nest' }))
    fireEvent.click(screen.getByRole('button', { name: /terminal/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /link existing folder/i })).toBeInTheDocument()
    })
    expect(onOpenRepoTerminal).not.toHaveBeenCalled()
  })

  // English-only UI: these two reasons were the last Spanish strings here.
  it('writes the stale-folder reasons in English', async () => {
    scopedState.repos = [{ ...repo('org/repo'), localPath: 'C:/dev/repo' }]
    ;(globalThis as unknown as { window: Window }).window.pathUtils = {
      exists: vi.fn().mockResolvedValue(false),
    } as never
    render(<PersonalWorkspace {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /terminal/i }))
    await waitFor(() => {
      expect(screen.getByText(/no longer exists/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Querés|carpeta/i)).not.toBeInTheDocument()
  })
})
