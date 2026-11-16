import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTeamRepos } from '../../hooks/useTeamRepos'

const rows: Record<string, unknown[]> = {}
let resolvers: Array<() => void> = []

// Hoisted so the vi.mock factory (which runs before the module body) can read it.
const del = vi.hoisted(() => ({ error: null as { message: string } | null }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_col: string, teamId: string) => ({
          order: () => new Promise(resolve => {
            resolvers.push(() => resolve({ data: rows[teamId] ?? [], error: null }))
          }),
        }),
      }),
      delete: () => ({
        eq: async () => ({ error: del.error }),
      }),
    }),
  },
}))

describe('useTeamRepos stale responses', () => {
  beforeEach(() => {
    resolvers = []
    rows.A = [{ id: 'a1', team_id: 'A', repo_full_name: 'org/a', repo_url: 'u', added_by: 'x', added_at: '', provider: 'github' }]
    rows.B = [{ id: 'b1', team_id: 'B', repo_full_name: 'org/b', repo_url: 'u', added_by: 'x', added_at: '', provider: 'github' }]
    ;(window as unknown as { localPaths: unknown }).localPaths = { getAll: async () => ({}) }
  })

  it('ignores a fetch that resolves after the team changed', async () => {
    const { result, rerender } = renderHook(({ id }) => useTeamRepos(id), { initialProps: { id: 'A' } })
    const refreshA = result.current.refresh()
    rerender({ id: 'B' })
    const refreshB = result.current.refresh()
    // Resolve B first, then the stale A.
    await act(async () => { resolvers.reverse().forEach(r => r()); await Promise.all([refreshB, refreshA]) })
    expect(result.current.repos.map(r => r.id)).toEqual(['b1'])
  })
})

describe('useTeamRepos.removeRepo', () => {
  let forgetPath: ReturnType<typeof vi.fn>

  beforeEach(() => {
    del.error = null
    resolvers = []
    rows.A = []
    forgetPath = vi.fn(async () => {})
    ;(window as unknown as { localPaths: unknown }).localPaths = {
      getAll: async () => ({}), set: vi.fn(), delete: forgetPath,
    }
  })

  it('forgets the local path once the row is really gone', async () => {
    const { result } = renderHook(() => useTeamRepos('A'))
    await act(async () => {
      const done = result.current.removeRepo('a1')
      // removeRepo's trailing refresh() needs its fetch resolved too.
      await waitFor(() => expect(resolvers.length).toBeGreaterThan(0))
      resolvers.forEach(r => r())
      await done
    })
    expect(forgetPath).toHaveBeenCalledWith('a1')
  })

  // A rejected delete (RLS says you're not a leader, network died) leaves the
  // repo in the team's list. Dropping the local path anyway would unlink the
  // user's folder from a repo that is still there.
  it('keeps the local path when the delete was rejected', async () => {
    del.error = { message: 'permission denied' }
    const { result } = renderHook(() => useTeamRepos('A'))
    await act(async () => { await result.current.removeRepo('a1') })
    expect(forgetPath).not.toHaveBeenCalled()
  })
})
