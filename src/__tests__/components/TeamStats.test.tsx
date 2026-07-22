import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import TeamStats, { onlineGithubLogins } from '../../components/TeamStats'
import type { TeamStatsData } from '../../hooks/useTeamStats'

const mockUseTeamStats = vi.fn()
vi.mock('../../hooks/useTeamStats', () => ({
  useTeamStats: (...args: unknown[]) => mockUseTeamStats(...args),
}))

const DEV_ALICE = {
  login: 'alice',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
  commits: 12, prsOpened: 2, prsMerged: 1, reviews: 4, issuesClosed: 3,
  lastEventAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  dailyCommits: [0, 2, 4, 1, 3, 2, 0],
}
const DEV_BOB = {
  login: 'bob',
  avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
  commits: 4, prsOpened: 0, prsMerged: 0, reviews: 0, issuesClosed: 0,
  lastEventAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  dailyCommits: [0, 0, 1, 0, 2, 1, 0],
}
const LOADED: { stats: TeamStatsData; loading: boolean; error: string | null } = {
  stats: {
    developers: [DEV_ALICE, DEV_BOB],
    totalCommits: 16,
    totalPrsMerged: 1,
    totalReviews: 4,
    mergeTimeHours: 6,
    reviewLatencyHours: 4,
    prSizes: { s: 3, m: 2, l: 1, xl: 0 },
    reviewCov: { mergedTotal: 5, reviewed: 4, pct: 0.8 },
    topDeveloper: DEV_ALICE,
    recentPrs: [],
    prevCommits: 10,
    prevPrsMerged: 2,
  },
  loading: false,
  error: null,
}
const EMPTY: { stats: TeamStatsData; loading: boolean; error: string | null } = {
  stats: {
    developers: [], totalCommits: 0, totalPrsMerged: 0, totalReviews: 0,
    mergeTimeHours: null, reviewLatencyHours: null,
    prSizes: { s: 0, m: 0, l: 0, xl: 0 }, reviewCov: { mergedTotal: 0, reviewed: 0, pct: 0 },
    topDeveloper: null, recentPrs: [], prevCommits: 0, prevPrsMerged: 0,
  },
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

const card = (label: string): HTMLElement =>
  screen.getByText(label).closest('.ts-card') as HTMLElement

describe('TeamStats (team flow & health)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTeamStats.mockReturnValue(LOADED)
  })

  it('does not crash going from loading to loaded (hook order)', () => {
    mockUseTeamStats.mockReturnValue({ ...EMPTY, loading: true })
    const { rerender } = render(<TeamStats {...defaultProps} />)
    mockUseTeamStats.mockReturnValue(LOADED)
    expect(() => rerender(<TeamStats {...defaultProps} />)).not.toThrow()
    expect(screen.getByText('16')).toBeTruthy()
  })

  it('shows the team totals in the overview cards', () => {
    render(<TeamStats {...defaultProps} />)
    expect(within(card('Commits')).getByText('16')).toBeTruthy()
    expect(within(card('PRs merged')).getByText('1')).toBeTruthy()
  })

  it('shows the online developer count from presence', () => {
    render(<TeamStats {...defaultProps} />)
    expect(within(card('Online now')).getByText('1')).toBeTruthy()
  })

  it('shows cycle time and review latency as flow metrics', () => {
    render(<TeamStats {...defaultProps} />)
    expect(within(card('Cycle time')).getByText('6h')).toBeTruthy()
    expect(within(card('Review latency')).getByText('4h')).toBeTruthy()
  })

  it('shows review coverage as a percentage of merged PRs', () => {
    render(<TeamStats {...defaultProps} />)
    const cov = card('Review coverage')
    expect(within(cov).getByText('80%')).toBeTruthy()
    expect(within(cov).getByText(/4\s*\/\s*5/)).toBeTruthy()
  })

  it('shows the PR size distribution (S/M/L/XL)', () => {
    const { container } = render(<TeamStats {...defaultProps} />)
    expect(screen.getByText(/PR size/i)).toBeTruthy()
    expect(container.querySelectorAll('.ts-prsize-row').length).toBe(4)
  })

  it('does NOT rank developers individually (no leaderboard table)', () => {
    const { container } = render(<TeamStats {...defaultProps} />)
    expect(container.querySelector('.ts-table')).toBeNull()
    expect(container.querySelector('.ts-rank')).toBeNull()
  })

  it('shows the connect-GitHub message when there is no token', () => {
    render(<TeamStats {...defaultProps} githubToken={null} />)
    expect(screen.getByText(/connect your github/i)).toBeTruthy()
  })

  it('shows the skeleton while loading', () => {
    mockUseTeamStats.mockReturnValue({ ...EMPTY, loading: true })
    const { container } = render(<TeamStats {...defaultProps} />)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(container.querySelectorAll('.ts-skeleton').length).toBeGreaterThan(0)
  })

  it('shows the error message', () => {
    mockUseTeamStats.mockReturnValue({ ...EMPTY, error: 'API rate limit exceeded' })
    render(<TeamStats {...defaultProps} />)
    expect(screen.getByText('API rate limit exceeded')).toBeTruthy()
  })
})

describe('onlineGithubLogins', () => {
  it('returns the github logins in lowercase, ignoring nulls', () => {
    const p = {
      a: { userId: 'a', displayName: 'x@co.com', githubLogin: 'Alice', repo: null, branch: null, lastSeen: '' },
      b: { userId: 'b', displayName: 'y@co.com', githubLogin: null, repo: null, branch: null, lastSeen: '' },
    }
    const set = onlineGithubLogins(p)
    expect(set.has('alice')).toBe(true)
    expect(set.size).toBe(1)
  })
})
