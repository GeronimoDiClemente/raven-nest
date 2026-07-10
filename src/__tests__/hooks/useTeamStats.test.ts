import { describe, it, expect } from 'vitest'
import { aggregateEvents, extractRecentPrs } from '../../hooks/useTeamStats'

const NOW = new Date().toISOString()
const OLD = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() // 8 días atrás

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
  it('cuenta commits de PushEvent de esta semana', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'fix' }, { sha: 'b', message: 'feat' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result).toHaveLength(1)
    expect(result[0].login).toBe('alice')
    expect(result[0].commits).toBe(2)
  })

  it('ignora eventos de hace más de 7 días', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', OLD, { commits: [{ sha: 'a', message: 'old' }] }),
    ]
    expect(aggregateEvents(events)).toHaveLength(0)
  })

  it('excluye eventos fuera de la ventana por defecto (7 días)', () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
    const events = [makeEvent('1', 'alice', 'PushEvent', twentyDaysAgo, { commits: [{ sha: 'a', message: 'x' }] })]
    expect(aggregateEvents(events)).toHaveLength(0)
  })

  it('incluye eventos de hace 20 días con ventana de 30', () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
    const events = [makeEvent('1', 'alice', 'PushEvent', twentyDaysAgo, { commits: [{ sha: 'a', message: 'x' }] })]
    const result = aggregateEvents(events, 30)
    expect(result).toHaveLength(1)
    expect(result[0].commits).toBe(1)
  })

  it('dimensiona dailyCommits según la ventana', () => {
    const events = [makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] })]
    expect(aggregateEvents(events, 7)[0].dailyCommits).toHaveLength(7)
    expect(aggregateEvents(events, 30)[0].dailyCommits).toHaveLength(30)
  })

  it('cuenta PRs abiertos y mergeados por separado', () => {
    const events = [
      makeEvent('1', 'bob', 'PullRequestEvent', NOW, { action: 'opened' }),
      makeEvent('2', 'bob', 'PullRequestEvent', NOW, { action: 'closed', pull_request: { merged: true } }),
      makeEvent('3', 'bob', 'PullRequestEvent', NOW, { action: 'closed', pull_request: { merged: false } }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].prsOpened).toBe(1)
    expect(result[0].prsMerged).toBe(1)
  })

  it('cuenta issues cerrados', () => {
    const events = [
      makeEvent('1', 'carol', 'IssuesEvent', NOW, { action: 'closed' }),
      makeEvent('2', 'carol', 'IssuesEvent', NOW, { action: 'opened' }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].issuesClosed).toBe(1)
  })

  it('agrupa múltiples eventos del mismo developer', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
      makeEvent('2', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'b', message: 'y' }, { sha: 'c', message: 'z' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result).toHaveLength(1)
    expect(result[0].commits).toBe(3)
  })

  it('ordena por commits descendente', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
      makeEvent('2', 'bob', 'PushEvent', NOW, { commits: [{ sha: 'b', message: 'y' }, { sha: 'c', message: 'z' }, { sha: 'd', message: 'w' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].login).toBe('bob')
    expect(result[1].login).toBe('alice')
  })

  it('deduplica eventos con el mismo id', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].commits).toBe(1)
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
