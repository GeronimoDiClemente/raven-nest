import { describe, it, expect } from 'vitest'
import { trendVsPrev, topAreasFromFiles } from '../../lib/employee-analytics'
import { perLoginPrev } from '../../lib/employee-analytics'

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
