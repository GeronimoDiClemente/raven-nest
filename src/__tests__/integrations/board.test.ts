import { describe, it, expect } from 'vitest'
import { deriveScope, deriveStatus, projectBoard, type BoardInputs } from '../../integrations/board'
import type { Ticket, WorktreeMeta } from '../../types'

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

const ticket = (key: string, state: Ticket['state'], title = key): Ticket => ({
  key, providerId: `id-${key}`, title, url: `https://x/${key}`, state, context: '',
})
const wt = (branch: string, repoPath: string, setupState: WorktreeMeta['setupState'] = 'running'): WorktreeMeta => ({
  repoPath, rootRepoPath: repoPath, branch, setupState,
  declaredPorts: [], detectedPorts: [], createdAt: 0, updatedAt: 0,
})

describe('projectBoard', () => {
  it('joins a linked ticket to its worktree, signal, scope and status', () => {
    const inp: BoardInputs = {
      tickets: [{ pluginId: 'github', ticket: ticket('#189', 'in_review', 'Race board') }],
      worktrees: [wt('gero/189-race', '/repos/raven-nest')],
      signals: [{ repoPath: '/repos/raven-nest', ci: 'success', changesRequested: true, prNumber: 42 }],
      links: [{ branch: 'gero/189-race', ticketKey: '#189' }],
      personalLogin: 'gero',
      repoFullName: () => 'RAVEN/raven-nest',
    }
    const [row] = projectBoard(inp)
    expect(row).toMatchObject({
      key: '#189', pluginId: 'github', title: 'Race board', branch: 'gero/189-race',
      worktreePath: '/repos/raven-nest', repoFullName: 'RAVEN/raven-nest',
      scope: { kind: 'org', org: 'RAVEN' }, status: 'needs_you',
      ci: 'success', changesRequested: true, prNumber: 42,
    })
  })

  it('linked worktree with no signal yet → working, null ci/pr', () => {
    const inp: BoardInputs = {
      tickets: [{ pluginId: 'jira', ticket: ticket('PROJ-9', 'in_progress', 'Wire it') }],
      worktrees: [wt('gero/proj-9-wire', '/repos/web', 'running')],
      signals: [],
      links: [{ branch: 'gero/proj-9-wire', ticketKey: 'PROJ-9' }],
      personalLogin: 'gero',
      repoFullName: () => 'RAVEN/web',
    }
    const [row] = projectBoard(inp)
    expect(row).toMatchObject({
      branch: 'gero/proj-9-wire', worktreePath: '/repos/web', repoFullName: 'RAVEN/web',
      scope: { kind: 'org', org: 'RAVEN' }, status: 'working',
      ci: null, changesRequested: false, prNumber: null,
    })
  })

  it('handles an unlinked ticket: no worktree, personal scope, status from ticket state', () => {
    const inp: BoardInputs = {
      tickets: [{ pluginId: 'github', ticket: ticket('#221', 'todo') }],
      worktrees: [], signals: [], links: [],
      personalLogin: 'gero', repoFullName: () => null,
    }
    const [row] = projectBoard(inp)
    expect(row).toMatchObject({
      key: '#221', branch: null, worktreePath: null, repoFullName: null,
      scope: { kind: 'personal' }, status: 'todo', changesRequested: false, ci: null, prNumber: null,
    })
  })
})
