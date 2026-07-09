import { describe, it, expect } from 'vitest'
import { aggregateEvents } from '../../hooks/useTeamStats'

const NOW = new Date().toISOString()
const OLD = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() // 8 días atrás

const makeEvent = (
  id: string,
  login: string,
  type: string,
  created_at: string,
  payload: object = {}
) => ({
  id,
  type,
  actor: { login, avatar_url: `https://avatars.githubusercontent.com/u/1?v=4` },
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
