import { describe, it, expect } from 'vitest'
import {
  eventsFromGraphQL,
  aggregateEvents,
  prSizeBuckets,
  medianMergeHours,
  reviewCoverage,
  medianReviewLatencyHours,
  openPrsFromGraphQL,
} from '../../hooks/useTeamStats'

const now = new Date().toISOString()
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

// The GitHub GraphQL API DOES return the fields the REST Events API strips
// (commit list, PR additions/deletions/timestamps, review submittedAt). These
// tests feed a GraphQL-shaped response through eventsFromGraphQL and assert the
// existing metric functions produce real (non-zero) numbers from it.
describe('eventsFromGraphQL', () => {
  it('turns commits into PushEvents the roster counts', () => {
    const events = eventsFromGraphQL('acme/api', {
      commits: [
        { oid: 'a1', committedDate: now, author: { user: { login: 'alice' }, avatarUrl: 'x' } },
        { oid: 'a2', committedDate: now, author: { user: { login: 'alice' }, avatarUrl: 'x' } },
      ],
      prs: [],
    })
    const devs = aggregateEvents(events, 7)
    expect(devs).toHaveLength(1)
    expect(devs[0].login).toBe('alice')
    expect(devs[0].commits).toBe(2)
  })

  it('turns merged PRs into events with size, merge time and a merged count', () => {
    const events = eventsFromGraphQL('acme/api', {
      commits: [],
      prs: [
        {
          id: 'PR1', number: 1, title: 'feat', createdAt: hoursAgo(3), mergedAt: hoursAgo(1),
          additions: 20, deletions: 10, author: { login: 'bob', avatarUrl: '' }, reviews: { nodes: [] },
        },
      ],
    })
    expect(prSizeBuckets(events, 7)).toEqual({ s: 1, m: 0, l: 0, xl: 0 })
    expect(medianMergeHours(events, 7)).toBeCloseTo(2, 3) // opened 3h ago, merged 1h ago
    expect(aggregateEvents(events, 7).find(d => d.login === 'bob')?.prsMerged).toBe(1)
  })

  it('turns PR reviews into review events for coverage and latency', () => {
    const events = eventsFromGraphQL('acme/api', {
      commits: [],
      prs: [
        {
          id: 'PR1', number: 1, title: '', createdAt: hoursAgo(10), mergedAt: hoursAgo(1),
          additions: 5, deletions: 0, author: { login: 'bob', avatarUrl: '' },
          reviews: { nodes: [{ author: { login: 'dana', avatarUrl: '' }, submittedAt: hoursAgo(8), state: 'APPROVED' }] },
        },
        {
          id: 'PR2', number: 2, title: '', createdAt: hoursAgo(20), mergedAt: hoursAgo(2),
          additions: 5, deletions: 0, author: { login: 'bob', avatarUrl: '' }, reviews: { nodes: [] },
        },
      ],
    })
    expect(reviewCoverage(events, 7)).toEqual({ mergedTotal: 2, reviewed: 1, pct: 0.5 })
    expect(medianReviewLatencyHours(events, 7)).toBeCloseTo(2, 3) // PR1 opened 10h, first review 8h ago → 2h
    expect(aggregateEvents(events, 7).find(d => d.login === 'dana')?.reviews).toBe(1)
  })

  it('still counts a commit whose author has no linked GitHub user (ghost)', () => {
    const events = eventsFromGraphQL('acme/api', {
      commits: [{ oid: 'z', committedDate: now, author: { user: null, avatarUrl: '', name: 'Some Name' } }],
      prs: [],
    })
    expect(aggregateEvents(events, 7).reduce((s, d) => s + d.commits, 0)).toBe(1)
  })

  it('skips a pending review that carries no submittedAt', () => {
    const events = eventsFromGraphQL('acme/api', {
      commits: [],
      prs: [
        {
          id: 'PR1', number: 1, title: '', createdAt: hoursAgo(5), mergedAt: hoursAgo(1),
          additions: 1, deletions: 0, author: { login: 'b', avatarUrl: '' },
          reviews: { nodes: [{ author: { login: 'c', avatarUrl: '' }, submittedAt: null, state: 'PENDING' }] },
        },
      ],
    })
    expect(reviewCoverage(events, 7).reviewed).toBe(0)
  })

  it('ignores an unmerged PR (mergedAt null)', () => {
    const events = eventsFromGraphQL('acme/api', {
      commits: [],
      prs: [
        {
          id: 'PR1', number: 1, title: '', createdAt: hoursAgo(5), mergedAt: null,
          additions: 1, deletions: 0, author: { login: 'b', avatarUrl: '' }, reviews: { nodes: [] },
        },
      ],
    })
    expect(aggregateEvents(events, 7).reduce((s, d) => s + d.prsMerged, 0)).toBe(0)
    expect(prSizeBuckets(events, 7)).toEqual({ s: 0, m: 0, l: 0, xl: 0 })
  })
})

describe('openPrsFromGraphQL', () => {
  it('maps open PR nodes to {login, repo, number, title, createdAt, reviewCount}', () => {
    const rows = openPrsFromGraphQL('acme/api', [
      { number: 7, title: 'wip: cache', createdAt: '2026-07-20T00:00:00Z',
        author: { login: 'ana', avatarUrl: 'x' }, reviews: { totalCount: 0 } },
      { number: 8, title: 'feat: x', createdAt: '2026-07-25T00:00:00Z',
        author: { login: 'bob', avatarUrl: 'y' }, reviews: { totalCount: 2 } },
    ])
    expect(rows).toEqual([
      { login: 'ana', avatarUrl: 'x', repo: 'acme/api', number: 7, title: 'wip: cache', createdAt: '2026-07-20T00:00:00Z', reviewCount: 0 },
      { login: 'bob', avatarUrl: 'y', repo: 'acme/api', number: 8, title: 'feat: x', createdAt: '2026-07-25T00:00:00Z', reviewCount: 2 },
    ])
  })
  it('skips a PR with no author (ghost)', () => {
    expect(openPrsFromGraphQL('o/r', [{ number: 1, title: 't', createdAt: 'z', author: null, reviews: { totalCount: 0 } }])).toEqual([])
  })
})
