import { describe, it, expect } from 'vitest'
import { aggregateEvents, extractRecentPrs, medianMergeHours } from '../../hooks/useTeamStats'

const NOW = new Date().toISOString()
const OLD = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() // 8 days ago

const makeEvent = (
  id: string,
  login: string,
  type: string,
  created_at: string,
  payload: object = {},
  repo = 'owner/repo'
) => ({
  id,
  type,
  actor: { login, avatar_url: `https://avatars.githubusercontent.com/u/1?v=4` },
  repo: { name: repo },
  created_at,
  payload,
})

describe('aggregateEvents', () => {
  it('counts PushEvent commits from this week', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'fix' }, { sha: 'b', message: 'feat' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result).toHaveLength(1)
    expect(result[0].login).toBe('alice')
    expect(result[0].commits).toBe(2)
  })

  it('ignores events older than 7 days', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', OLD, { commits: [{ sha: 'a', message: 'old' }] }),
    ]
    expect(aggregateEvents(events)).toHaveLength(0)
  })

  it('excludes events outside the default window (7 days)', () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
    const events = [makeEvent('1', 'alice', 'PushEvent', twentyDaysAgo, { commits: [{ sha: 'a', message: 'x' }] })]
    expect(aggregateEvents(events)).toHaveLength(0)
  })

  it('includes events from 20 days ago with a 30-day window', () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
    const events = [makeEvent('1', 'alice', 'PushEvent', twentyDaysAgo, { commits: [{ sha: 'a', message: 'x' }] })]
    const result = aggregateEvents(events, 30)
    expect(result).toHaveLength(1)
    expect(result[0].commits).toBe(1)
  })

  it('sizes dailyCommits to the window', () => {
    const events = [makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] })]
    expect(aggregateEvents(events, 7)[0].dailyCommits).toHaveLength(7)
    expect(aggregateEvents(events, 30)[0].dailyCommits).toHaveLength(30)
  })

  it('does NOT create a developer for non-contribution events (star/fork)', () => {
    const events = [
      makeEvent('1', 'randouser', 'WatchEvent', NOW, { action: 'started' }),
      makeEvent('2', 'forker', 'ForkEvent', NOW, {}),
      makeEvent('3', 'commenter', 'IssueCommentEvent', NOW, { action: 'created' }),
    ]
    expect(aggregateEvents(events)).toHaveLength(0)
  })

  it('excludes bot actors from the roster', () => {
    const events = [
      makeEvent('1', 'dependabot[bot]', 'PullRequestEvent', NOW, { action: 'opened' }),
      makeEvent('2', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result).toHaveLength(1)
    expect(result[0].login).toBe('alice')
  })

  it('counts opened and merged PRs separately', () => {
    const events = [
      makeEvent('1', 'bob', 'PullRequestEvent', NOW, { action: 'opened' }),
      makeEvent('2', 'bob', 'PullRequestEvent', NOW, { action: 'closed', pull_request: { merged: true } }),
      makeEvent('3', 'bob', 'PullRequestEvent', NOW, { action: 'closed', pull_request: { merged: false } }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].prsOpened).toBe(1)
    expect(result[0].prsMerged).toBe(1)
  })

  it('counts reviews from PullRequestReviewEvent (action created)', () => {
    const events = [
      makeEvent('1', 'dana', 'PullRequestReviewEvent', NOW, { action: 'created' }),
      makeEvent('2', 'dana', 'PullRequestReviewEvent', NOW, { action: 'created' }),
      makeEvent('3', 'dana', 'PullRequestReviewEvent', NOW, { action: 'dismissed' }),
    ]
    const result = aggregateEvents(events)
    expect(result).toHaveLength(1)
    expect(result[0].reviews).toBe(2)
  })

  it('counts closed issues', () => {
    const events = [
      makeEvent('1', 'carol', 'IssuesEvent', NOW, { action: 'closed' }),
      makeEvent('2', 'carol', 'IssuesEvent', NOW, { action: 'opened' }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].issuesClosed).toBe(1)
  })

  it('groups multiple events from the same developer', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
      makeEvent('2', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'b', message: 'y' }, { sha: 'c', message: 'z' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result).toHaveLength(1)
    expect(result[0].commits).toBe(3)
  })

  it('sorts by commits descending', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
      makeEvent('2', 'bob', 'PushEvent', NOW, { commits: [{ sha: 'b', message: 'y' }, { sha: 'c', message: 'z' }, { sha: 'd', message: 'w' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].login).toBe('bob')
    expect(result[1].login).toBe('alice')
  })

  it('deduplicates events with the same id', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].commits).toBe(1)
  })
})

describe('medianMergeHours', () => {
  const merged = (id: string, createdHoursAgo: number, mergedHoursAgo: number) =>
    makeEvent(id, 'x', 'PullRequestEvent', new Date(Date.now() - mergedHoursAgo * 3_600_000).toISOString(), {
      action: 'closed',
      pull_request: {
        merged: true,
        created_at: new Date(Date.now() - createdHoursAgo * 3_600_000).toISOString(),
        merged_at: new Date(Date.now() - mergedHoursAgo * 3_600_000).toISOString(),
      },
    })

  it('returns null if there are no merged PRs with dates', () => {
    expect(medianMergeHours([])).toBeNull()
    expect(medianMergeHours([makeEvent('1', 'a', 'PushEvent', NOW, {})])).toBeNull()
  })

  it('computes the median open→merge hours', () => {
    // durations: 2h, 4h, 12h → median 4h
    const events = [merged('1', 3, 1), merged('2', 6, 2), merged('3', 24, 12)]
    expect(medianMergeHours(events)).toBeCloseTo(4, 3)
  })

  it('averages the two middle values for an even count', () => {
    // durations: 2h, 6h → median 4h
    const events = [merged('1', 3, 1), merged('2', 8, 2)]
    expect(medianMergeHours(events)).toBeCloseTo(4, 3)
  })
})

describe('extractRecentPrs', () => {
  it('returns merged PRs with title and repo', () => {
    const events = [
      makeEvent('1', 'alice', 'PullRequestEvent', NOW,
        { action: 'closed', pull_request: { merged: true, title: 'feat: add login' } },
        'acme/api'),
    ]
    const result = extractRecentPrs(events)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('feat: add login')
    expect(result[0].repo).toBe('acme/api')
    expect(result[0].login).toBe('alice')
  })

  it('ignores unmerged closed PRs', () => {
    const events = [
      makeEvent('1', 'bob', 'PullRequestEvent', NOW,
        { action: 'closed', pull_request: { merged: false, title: 'wip' } }),
    ]
    expect(extractRecentPrs(events)).toHaveLength(0)
  })

  it('ignores events older than 7 days', () => {
    const events = [
      makeEvent('1', 'alice', 'PullRequestEvent', OLD,
        { action: 'closed', pull_request: { merged: true, title: 'old PR' } }),
    ]
    expect(extractRecentPrs(events)).toHaveLength(0)
  })

  it('sorts by mergedAt descending', () => {
    const earlier = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const later   = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
    const events = [
      makeEvent('1', 'alice', 'PullRequestEvent', earlier,
        { action: 'closed', pull_request: { merged: true, title: 'first' } }),
      makeEvent('2', 'bob', 'PullRequestEvent', later,
        { action: 'closed', pull_request: { merged: true, title: 'second' } }),
    ]
    const result = extractRecentPrs(events)
    expect(result[0].title).toBe('second')
    expect(result[1].title).toBe('first')
  })

  it('also check dailyCommits populated — today slot incremented', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }, { sha: 'b', message: 'y' }] }),
    ]
    const result = aggregateEvents(events)
    // index 6 = today
    expect(result[0].dailyCommits[6]).toBe(2)
    // other slots should be 0
    expect(result[0].dailyCommits.slice(0, 6).every((v: number) => v === 0)).toBe(true)
  })
})
