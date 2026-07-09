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
          dailyCommits: [0, 2, 4, 1, 3, 2, 0],
        },
        {
          login: 'bob',
          avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
          commits: 4,
          prsOpened: 0,
          prsMerged: 0,
          issuesClosed: 0,
          lastEventAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          dailyCommits: [0, 0, 1, 0, 2, 1, 0],
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
        dailyCommits: [0, 2, 4, 1, 3, 2, 0],
      },
      recentPrs: [
        {
          id: 'evt-1',
          login: 'alice',
          avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
          title: 'feat: add team stats dashboard',
          repo: 'org/repo',
          mergedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        },
      ],
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

  it('muestra el feed de PRs mergeados', () => {
    render(<TeamStats {...defaultProps} />)
    expect(screen.getByText('feat: add team stats dashboard')).toBeTruthy()
    expect(screen.getByText('merged')).toBeTruthy()
  })

  it('renderiza la sparkline (7 barras por developer)', () => {
    render(<TeamStats {...defaultProps} />)
    const sparkBars = document.querySelectorAll('.ts-spark-bar')
    // 2 developers × 7 bars each = 14
    expect(sparkBars.length).toBe(14)
  })
})
