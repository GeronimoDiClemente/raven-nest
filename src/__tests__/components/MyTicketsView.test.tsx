import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import MyTicketsView from '../../components/IntegrationPanel/MyTicketsView'

const ticket = { key: 'PROJ-1', providerId: 'p1', title: 'Fix auth', url: 'u', state: 'todo' as const, context: 'ctx' }

beforeEach(() => {
  ;(window as never as Record<string, unknown>).tickets = {
    list: vi.fn().mockResolvedValue([ticket]),
    branchName: vi.fn().mockResolvedValue('gero/PROJ-1-fix-auth'),
    startWork: vi.fn().mockResolvedValue({ ok: true }),
  }
  // Real worktree:create returns { ok: true, meta: WorktreeMeta } where the
  // worktree path lives in meta.repoPath (see electron/main.ts handler).
  ;(window as never as Record<string, unknown>).worktree = {
    create: vi.fn().mockResolvedValue({ ok: true, meta: { repoPath: '/tmp/wt' } }),
  }
})

describe('MyTicketsView', () => {
  it('lista los tickets asignados', async () => {
    render(<MyTicketsView pluginId="jira" repoPath="/repo" githubLogin="gero" onOpenWorktree={() => {}} />)
    await waitFor(() => expect(screen.getByText('Fix auth')).toBeTruthy())
    expect(screen.getByText('PROJ-1')).toBeTruthy()
  })

  it('Work on this: crea worktree con el branch del ticket y notifica', async () => {
    const onOpen = vi.fn()
    render(<MyTicketsView pluginId="jira" repoPath="/repo" githubLogin="gero" onOpenWorktree={onOpen} />)
    await waitFor(() => screen.getByText('Fix auth'))
    fireEvent.click(screen.getByRole('button', { name: /work on this/i }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('/tmp/wt'))
    const wt = (window as never as { worktree: { create: ReturnType<typeof vi.fn> } }).worktree
    expect(wt.create).toHaveBeenCalledWith({ repoPath: '/repo', branch: 'gero/PROJ-1-fix-auth' })
    const tk = (window as never as { tickets: { startWork: ReturnType<typeof vi.fn> } }).tickets
    expect(tk.startWork).toHaveBeenCalledWith({
      pluginId: 'jira', ticket, branch: 'gero/PROJ-1-fix-auth', worktreePath: '/tmp/wt',
    })
  })

  it('si worktree.create falla muestra el error y NO llama startWork', async () => {
    ;(window as never as { worktree: { create: ReturnType<typeof vi.fn> } }).worktree.create =
      vi.fn().mockResolvedValue({ ok: false, error: 'branch exists' })
    render(<MyTicketsView pluginId="jira" repoPath="/repo" githubLogin="gero" onOpenWorktree={() => {}} />)
    await waitFor(() => screen.getByText('Fix auth'))
    fireEvent.click(screen.getByRole('button', { name: /work on this/i }))
    await waitFor(() => expect(screen.getByText(/branch exists/i)).toBeTruthy())
    const tk = (window as never as { tickets: { startWork: ReturnType<typeof vi.fn> } }).tickets
    expect(tk.startWork).not.toHaveBeenCalled()
  })
})
