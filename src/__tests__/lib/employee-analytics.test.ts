import { describe, it, expect } from 'vitest'
import { trendVsPrev, topAreasFromFiles } from '../../lib/employee-analytics'
import { perLoginPrev } from '../../lib/employee-analytics'
import { openPrSignal, attentionFor, buildRoster } from '../../lib/employee-analytics'

describe('trendVsPrev', () => {
  it('returns a signed percentage delta vs the previous period', () => {
    expect(trendVsPrev(120, 100)).toBe(20)
    expect(trendVsPrev(80, 100)).toBe(-20)
  })
  it('is 0 when unchanged, and null when there is no previous baseline', () => {
    expect(trendVsPrev(50, 50)).toBe(0)
    expect(trendVsPrev(5, 0)).toBeNull() // no baseline → "new", caller renders specially
  })
})

describe('topAreasFromFiles', () => {
  it('sums additions+deletions per top-2 path segments, sorted desc', () => {
    const prs = [
      { files: [{ path: 'src/components/A.tsx', additions: 10, deletions: 5 }, { path: 'src/components/B.tsx', additions: 3, deletions: 2 }] },
      { files: [{ path: 'src/hooks/x.ts', additions: 40, deletions: 0 }] },
      { files: [{ path: 'README.md', additions: 1, deletions: 1 }] },
    ]
    expect(topAreasFromFiles(prs, 2)).toEqual([
      { dir: 'src/hooks', lines: 40 },
      { dir: 'src/components', lines: 20 },
    ])
  })
  it('is empty when no PR carries files', () => {
    expect(topAreasFromFiles([{ files: [] }], 5)).toEqual([])
  })
})

const ev = (login: string, type: string, daysAgo: number, payload: object = {}) => ({
  id: `${login}-${type}-${daysAgo}-${Math.random()}`,
  type,
  actor: { login, avatar_url: '' },
  repo: { name: 'o/r' },
  created_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  payload,
})

describe('perLoginPrev', () => {
  it('totals commits and merged PRs per login for the PREVIOUS window only', () => {
    const events = [
      ev('ana', 'PushEvent', 2, { commits: [{ sha: 'a' }] }),
      ev('ana', 'PushEvent', 10, { commits: [{ sha: 'b' }, { sha: 'c' }] }),
      ev('ana', 'PullRequestEvent', 12, { action: 'closed', pull_request: { merged: true } }),
    ]
    const prev = perLoginPrev(events as never, 7)
    expect(prev.ana).toEqual({ commits: 2, prsMerged: 1 })
  })
  it('has no entry for a login with no previous activity', () => {
    const events = [ev('bob', 'PushEvent', 1, { commits: [{ sha: 'a' }] })]
    expect(perLoginPrev(events as never, 7).bob).toBeUndefined()
  })
})

const daysAgoIso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

describe('openPrSignal', () => {
  it('flags an old PR with no review as stuck + awaitingReview', () => {
    const s = openPrSignal({ createdAt: daysAgoIso(6), reviewCount: 0 })
    expect(s).toEqual({ ageDays: 6, stuck: true, awaitingReview: true })
  })
  it('a fresh reviewed PR is neither stuck nor awaiting', () => {
    const s = openPrSignal({ createdAt: daysAgoIso(1), reviewCount: 2 })
    expect(s).toEqual({ ageDays: 1, stuck: false, awaitingReview: false })
  })
})

describe('attentionFor', () => {
  it('flags a big activity drop as "Quiet"', () => {
    const chip = attentionFor({ commits: 5, prevCommits: 40 }, [], 'viewer')
    expect(chip).toEqual({ cls: 'warn', text: 'Quiet — activity down' })
  })
  it('flags a stuck open PR', () => {
    const chip = attentionFor({ commits: 30, prevCommits: 28 }, [{ createdAt: daysAgoIso(6), reviewCount: 0 }], 'viewer')
    expect(chip).toEqual({ cls: 'warn', text: 'PR stuck 6d' })
  })
  it('returns null when nothing needs attention', () => {
    expect(attentionFor({ commits: 30, prevCommits: 28 }, [{ createdAt: daysAgoIso(1), reviewCount: 1 }], 'viewer')).toBeNull()
  })
})

describe('buildRoster', () => {
  const dev = (login: string, commits: number, prsMerged = 0) => ({ login, avatarUrl: `av/${login}`, commits, prsMerged })
  const member = (login: string | null, name: string) => ({ login, name, avatarUrl: '', online: false })

  it('matches a registered member to their GitHub stats case-insensitively', () => {
    const rows = buildRoster([member('Ada', 'Ada L.')], [dev('ada', 12, 3)], { ada: { commits: 5 } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ login: 'Ada', name: 'Ada L.', commits: 12, prsMerged: 3, prevCommits: 5 })
  })

  it('appends GitHub contributors who are not registered members', () => {
    const rows = buildRoster([member('ada', 'Ada')], [dev('ada', 1), dev('grace', 8, 2)], {})
    const grace = rows.find(r => r.login === 'grace')
    expect(grace).toMatchObject({ login: 'grace', name: 'grace', avatarUrl: 'av/grace', commits: 8, prsMerged: 2, online: false })
    expect(rows).toHaveLength(2)
  })

  it('excludes bots and the unknown fallback from appended contributors', () => {
    const rows = buildRoster([], [dev('dependabot[bot]', 40), dev('unknown', 9), dev('grace', 3)], {})
    expect(rows.map(r => r.login)).toEqual(['grace'])
  })

  it('keeps a member with no linked GitHub login (login null, zero stats)', () => {
    const rows = buildRoster([member(null, 'no-gh@x.com')], [], {})
    expect(rows).toEqual([{ login: null, name: 'no-gh@x.com', avatarUrl: '', online: false, commits: 0, prsMerged: 0, prevCommits: 0 }])
  })

  it('does not duplicate a contributor already present as a member', () => {
    const rows = buildRoster([member('Ada', 'Ada')], [dev('ada', 4)], {})
    expect(rows).toHaveLength(1)
    expect(rows[0].login).toBe('Ada')
  })
})
