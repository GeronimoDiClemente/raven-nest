import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTeamRepos } from '../../hooks/useTeamRepos'

const rows: Record<string, unknown[]> = {}
let resolvers: Array<() => void> = []

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
