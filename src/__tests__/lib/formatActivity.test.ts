import { describe, it, expect } from 'vitest'
import { formatActivity, timeAgo } from '../../lib/formatActivity'
import type { DomainEvent } from '../../types'

describe('formatActivity', () => {
  it('formats pr.merged', () => {
    const ev: DomainEvent = { type: 'pr.merged', branch: 'feat/x', repoFullName: 'o/r' }
    expect(formatActivity(ev)).toEqual({ icon: '✅', text: 'merged `feat/x`' })
  })

  it('formats ci.failed', () => {
    const ev: DomainEvent = { type: 'ci.failed', branch: 'feat/x', repoFullName: 'o/r' }
    expect(formatActivity(ev)).toEqual({ icon: '🔴', text: 'CI failed `feat/x`' })
  })

  it('formats changes.requested', () => {
    const ev: DomainEvent = { type: 'changes.requested', branch: 'feat/x', repoFullName: 'o/r', prNumber: 3 }
    expect(formatActivity(ev)).toEqual({ icon: '✏️', text: 'changes requested' })
  })

  it('formats review.requested', () => {
    const ev: DomainEvent = { type: 'review.requested', repoFullName: 'o/r', prNumber: 3, prTitle: 'Fix the thing' }
    expect(formatActivity(ev)).toEqual({ icon: '👀', text: 'review requested' })
  })

  it('formats pr.opened', () => {
    const ev: DomainEvent = { type: 'pr.opened', branch: 'feat/x', repoFullName: 'o/r' }
    expect(formatActivity(ev)).toEqual({ icon: '🔀', text: 'PR opened `feat/x`' })
  })

  it('formats task.created', () => {
    const ev: DomainEvent = {
      type: 'task.created', taskId: 't1', pluginId: 'jira', providerId: 'p1',
      repoFullName: null, branch: 'feat/x',
    }
    expect(formatActivity(ev)).toEqual({ icon: '🪺', text: 'task created `feat/x`' })
  })

  it('falls back to the raw type for unmapped events', () => {
    const ev: DomainEvent = { type: 'session.closed', branch: 'feat/x' }
    expect(formatActivity(ev)).toEqual({ icon: '•', text: 'session.closed' })
  })
})

describe('timeAgo', () => {
  const now = 1_000_000_000

  it('renders minutes for < 1h', () => {
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5m')
  })

  it('renders hours for < 24h', () => {
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3h')
  })

  it('renders days for < 30d', () => {
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe('2d')
  })

  it('renders months for >= 30d', () => {
    expect(timeAgo(now - 60 * 86_400_000, now)).toBe('2mo')
  })
})
