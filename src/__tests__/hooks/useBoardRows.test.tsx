// @vitest-environment jsdom
// useBoardRows assembles projectBoard() from the live bridges (tickets,
// worktree, signals) plus the installed-plugins list. One happy-path row:
// a github ticket linked to a running worktree with a green signal → 'working'.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { Ticket, WorktreeMeta, WorktreeSignalDTO } from '../../types'

vi.mock('../../hooks/useInstalledPlugins', () => ({
  useInstalledPlugins: () => ({
    installed: [{ pluginId: 'github', scope: 'personal', enabled: true, config: {} }],
  }),
}))

import { useBoardRows } from '../../hooks/useBoardRows'

const ticket: Ticket = {
  key: 'PROJ-1',
  providerId: 'id-1',
  title: 'Wire the board',
  url: 'https://x/PROJ-1',
  state: 'in_review',
  context: '',
}

const worktree: WorktreeMeta = {
  repoPath: '/r',
  rootRepoPath: '/r',
  branch: 'gero/proj-1-wire',
  setupState: 'running',
  declaredPorts: [],
  detectedPorts: [],
  createdAt: 0,
  updatedAt: 0,
}

const signal: WorktreeSignalDTO = {
  repoPath: '/r',
  ci: 'success',
  changesRequested: false,
  repo: 'RAVEN/x',
  prNumber: 1,
}

beforeEach(() => {
  Object.assign(window as unknown as Record<string, unknown>, {
    tickets: {
      list: vi.fn().mockResolvedValue([ticket]),
      tracked: vi.fn().mockResolvedValue([{ branch: worktree.branch, ticketKey: ticket.key }]),
    },
    worktree: { listAll: vi.fn().mockResolvedValue({ ok: true, worktrees: [worktree] }) },
    signals: { list: vi.fn().mockResolvedValue([signal]), onUpdate: vi.fn(() => () => {}) },
  })
})

describe('useBoardRows', () => {
  it('assembles a board row from tickets + worktree + signal', async () => {
    const { result } = renderHook(() => useBoardRows('gero'))
    await waitFor(() => expect(result.current.rows.length).toBe(1))
    const [row] = result.current.rows
    expect(row).toMatchObject({
      key: 'PROJ-1',
      branch: 'gero/proj-1-wire',
      scope: { kind: 'org', org: 'RAVEN' },
      status: 'working',
    })
  })
})
