import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import TeamStats, { onlineGithubLogins } from '../../components/TeamStats'
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
    prevCommits: 10,
    prevPrsMerged: 2,
  },
  loading: false,
  error: null,
}
const EMPTY: { stats: TeamStatsData; loading: boolean; error: string | null } = {
  stats: { developers: [], totalCommits: 0, totalPrsMerged: 0, topDeveloper: null, recentPrs: [], prevCommits: 0, prevPrsMerged: 0 },
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
    expect(screen.getAllByText('alice').length).toBeGreaterThan(0)
  })

  it('muestra el conteo de commits totales en las cards de overview', () => {
    render(<TeamStats {...defaultProps} />)
    expect(screen.getByText('16')).toBeTruthy()
  })

  it('muestra el developer más activo', () => {
    render(<TeamStats {...defaultProps} />)
    expect(screen.getAllByText('alice').length).toBeGreaterThan(0)
  })

  it('muestra el conteo de developers online desde presence', () => {
    render(<TeamStats {...defaultProps} />)
    const onlineCard = screen.getByText('Online now').closest('.ts-card')!
    expect(within(onlineCard).getByText('1')).toBeTruthy()
  })

  it('muestra la tabla con ambos developers', () => {
    const { container } = render(<TeamStats {...defaultProps} />)
    const table = container.querySelector('.ts-table') as HTMLElement
    expect(within(table).getByText('alice')).toBeTruthy()
    expect(within(table).getByText('bob')).toBeTruthy()
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

  it('muestra el skeleton mientras carga', () => {
    mockUseTeamStats.mockReturnValue({ ...EMPTY, loading: true })
    const { container } = render(<TeamStats {...defaultProps} />)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(container.querySelectorAll('.ts-skeleton').length).toBeGreaterThan(0)
  })

  it('muestra el mensaje de error', () => {
    mockUseTeamStats.mockReturnValue({ ...EMPTY, error: 'API rate limit exceeded' })
    render(<TeamStats {...defaultProps} />)
    expect(screen.getByText('API rate limit exceeded')).toBeTruthy()
  })

  it('reordena por PRs al clickear el header', () => {
    const { getByRole } = render(<TeamStats {...defaultProps} />)
    // Orden inicial: por commits desc → alice (12) antes que bob (4)
    let names = Array.from(document.querySelectorAll('.ts-dev-name')).map(n => n.textContent)
    expect(names).toEqual(['alice', 'bob'])
    // Click en "PRs": alice tiene 3 (2+1), bob 0. 1er click = desc, 2do = asc → invierte.
    const prsHeader = getByRole('button', { name: /PRs/i })
    fireEvent.click(prsHeader)  // desc por prs
    fireEvent.click(prsHeader)  // asc por prs
    names = Array.from(document.querySelectorAll('.ts-dev-name')).map(n => n.textContent)
    expect(names).toEqual(['bob', 'alice'])
  })
})

describe('onlineGithubLogins', () => {
  it('devuelve los github logins en minúscula, ignorando nulls', () => {
    const p = {
      a: { userId: 'a', displayName: 'x@co.com', githubLogin: 'Alice', repo: null, branch: null, lastSeen: '' },
      b: { userId: 'b', displayName: 'y@co.com', githubLogin: null, repo: null, branch: null, lastSeen: '' },
    }
    const set = onlineGithubLogins(p)
    expect(set.has('alice')).toBe(true)
    expect(set.size).toBe(1)
  })
})
