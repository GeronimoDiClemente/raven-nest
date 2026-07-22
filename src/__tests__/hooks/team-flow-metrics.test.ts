import { describe, it, expect } from 'vitest'
import { prSizeBuckets, reviewCoverage } from '../../hooks/useTeamStats'

const now = new Date().toISOString()

// Minimal GitHub Events API shapes (only the fields the metrics read).
const mergedPR = (id: string, number: number, additions: number | undefined, deletions: number | undefined, repo = 'o/r') => ({
  id, type: 'PullRequestEvent', actor: { login: 'a', avatar_url: '' }, repo: { name: repo },
  created_at: now,
  payload: { action: 'closed', pull_request: { merged: true, number, additions, deletions, created_at: now, merged_at: now } },
})
const review = (id: string, number: number, repo = 'o/r', state = 'approved') => ({
  id, type: 'PullRequestReviewEvent', actor: { login: 'b', avatar_url: '' }, repo: { name: repo },
  created_at: now,
  payload: { action: 'created', review: { state, submitted_at: now }, pull_request: { number, created_at: now } },
})

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('prSizeBuckets', () => {
  it('buckets merged PRs by lines changed (additions + deletions)', () => {
    const events = [
      mergedPR('1', 1, 20, 10),   // 30  → S
      mergedPR('2', 2, 100, 50),  // 150 → M
      mergedPR('3', 3, 250, 150), // 400 → L
      mergedPR('4', 4, 700, 100), // 800 → XL
    ]
    expect(prSizeBuckets(events as any)).toEqual({ s: 1, m: 1, l: 1, xl: 1 })
  })

  it('skips PRs with no size info', () => {
    expect(prSizeBuckets([mergedPR('1', 1, undefined, undefined)] as any)).toEqual({ s: 0, m: 0, l: 0, xl: 0 })
  })
})

describe('reviewCoverage', () => {
  it('is the fraction of merged PRs with at least one review', () => {
    const events = [mergedPR('1', 1, 10, 0), mergedPR('2', 2, 10, 0), review('3', 1)]
    expect(reviewCoverage(events as any)).toEqual({ mergedTotal: 2, reviewed: 1, pct: 0.5 })
  })

  it('is null-safe with no merged PRs', () => {
    expect(reviewCoverage([] as any)).toEqual({ mergedTotal: 0, reviewed: 0, pct: 0 })
  })
})
