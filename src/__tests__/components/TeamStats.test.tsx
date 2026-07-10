import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import TeamStats from '../../components/TeamStats'
import type { TeamStatsData } from '../../hooks/useTeamStats'

const mockUseTeamStats = vi.fn()
vi.mock('../../hooks/useTeamStats', () => ({
  useTeamStats: (...args: unknown[]) => mockUseTeamStats(...args),
}))

const DEV_ALICE = {
  login: 'alice',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
  commits: 12, prsOpened: 2, prsMerged: 1, issuesClosed: 3,
  lastEventAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  dailyCommits: [0, 2, 4, 1, 3, 2, 0],
}
const DEV_BOB = {
  login: 'bob',
  avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
  commits: 4, prsOpened: 0, prsMerged: 0, issuesClosed: 0,
  lastEventAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  dailyCommits: [0, 0, 1, 0, 2, 1, 0],
}
const LOADED: { stats: TeamStatsData; loading: boolean; error: string | null } = {
  stats: {
    developers: [DEV_ALICE, DEV_BOB],
    totalCommits: 16,
    totalPrsMerged: 1,
    topDeveloper: DEV_ALICE,
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
}
const EMPTY: { stats: TeamStatsData; loading: boolean; error: string | null } = {
  stats: { developers: [], totalCommits: 0, totalPrsMerged: 0, topDeveloper: null, recentPrs: [] },
  loading: false,
  error: null,
}

const presence = {
  'user-alice': { userId: 'user-alice', displayName: 'alice@co.com', githubLogin: 'alice', repo: 'org/repo', branch: 'main', lastSeen: new Date().toISOString() },
}

const defaultProps = {
  repos: [{ repo_full_name: 'org/repo' }],
  githubToken: 'token',
  presence,
}

describe('TeamStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTeamStats.mockReturnValue(LOADED)
  })

  it('no crashea al pasar de loading a cargado (orden de hooks)', () => {
    mockUseTeamStats.mockReturnValue({ ...EMPTY, loading: true })
    const { rerender } = render(<TeamStats {...defaultProps} />)
    mockUseTeamStats.mockReturnValue(LOADED)
    // Si el useMemo está después de un early return, este rerender tira
    // "Rendered more hooks than during the previous render".
    expect(() => rerender(<TeamStats {...defaultProps} />)).not.toThrow()
    expect(screen.getByText('alice')).toBeTruthy()
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

  it('renderiza una sparkline SVG por developer', () => {
    render(<TeamStats {...defaultProps} />)
    const sparks = document.querySelectorAll('.ts-spark')
    // 1 SVG sparkline per developer
    expect(sparks.length).toBe(2)
  })
})
