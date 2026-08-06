import { describe, it, expect } from 'vitest'
import { deriveScope, deriveStatus } from '../integrations/board'

describe('deriveScope', () => {
  it('is personal when there is no repo', () => {
    expect(deriveScope(null, 'gero')).toEqual({ kind: 'personal' })
  })
  it('is personal when the owner is the signed-in user (case-insensitive)', () => {
    expect(deriveScope('Gero/dotfiles', 'gero')).toEqual({ kind: 'personal' })
  })
  it('is org when the owner is not the user', () => {
    expect(deriveScope('RAVEN/raven-nest', 'gero')).toEqual({ kind: 'org', org: 'RAVEN' })
  })
})

describe('deriveStatus', () => {
  it('needs_you when changes are requested', () => {
    expect(deriveStatus('in_review', 'done', { ci: 'success', changesRequested: true })).toBe('needs_you')
  })
  it('needs_you when CI failed', () => {
    expect(deriveStatus('in_progress', 'done', { ci: 'failure', changesRequested: false })).toBe('needs_you')
  })
  it('done when the ticket is done and no red signal', () => {
    expect(deriveStatus('done', 'done', { ci: 'success', changesRequested: false })).toBe('done')
  })
  it('working while the worktree setup is running', () => {
    expect(deriveStatus('in_progress', 'running', null)).toBe('working')
  })
  it('todo when the ticket is todo and has no worktree', () => {
    expect(deriveStatus('todo', null, null)).toBe('todo')
  })
  it('working when in progress with no worktree yet', () => {
    expect(deriveStatus('in_progress', null, null)).toBe('working')
  })
})
