import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import TeamStats from '../../components/TeamStats'

vi.mock('../../hooks/useTeamStats', () => ({
  useTeamStats: () => ({
    stats: {
      developers: [
        {
          login: 'alice',
          avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
          commits: 12,
          prsOpened: 2,
          prsMerged: 1,
          issuesClosed: 3,
          lastEventAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        },
        {
          login: 'bob',
          avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
          commits: 4,
          prsOpened: 0,
          prsMerged: 0,
          issuesClosed: 0,
          lastEventAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        },
      ],
      totalCommits: 16,
      totalPrsMerged: 1,
      topDeveloper: {
        login: 'alice',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        commits: 12,
        prsOpened: 2,
        prsMerged: 1,
        issuesClosed: 3,
        lastEventAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    },
    loading: false,
    error: null,
  }),
}))

const presence = {
  'user-alice': { userId: 'user-alice', displayName: 'alice@co.com', repo: 'org/repo', branch: 'main', lastSeen: new Date().toISOString() },
}

const defaultProps = {
  repos: [{ repo_full_name: 'org/repo' }],
  githubToken: 'token',
  presence,
}

describe('TeamStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('muestra el conteo de commits totales en las cards de overview', () => {
    render(<TeamStats {...defaultProps} />)
    expect(screen.getByText('16')).toBeTruthy()
  })

  it('muestra el developer más activo', () => {
    render(<TeamStats {...defaultProps} />)
    expect(screen.getByText('alice')).toBeTruthy()
  })

  it('muestra el conteo de developers online desde presence', () => {
    render(<TeamStats {...defaultProps} />)
    const onlineCard = screen.getByText('Online now').closest('.ts-card')!
    expect(within(onlineCard).getByText('1')).toBeTruthy()
  })

  it('muestra la tabla con ambos developers', () => {
    render(<TeamStats {...defaultProps} />)
    expect(screen.getByText('alice')).toBeTruthy()
    expect(screen.getByText('bob')).toBeTruthy()
  })

  it('muestra mensaje de conectar GitHub cuando no hay token', () => {
    render(<TeamStats {...defaultProps} githubToken={null} />)
    expect(screen.getByText(/connect your github/i)).toBeTruthy()
  })
})
