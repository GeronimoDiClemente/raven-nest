import { describe, it, expect, vi } from 'vitest'
import { WorktreeSignals } from '../integrations/worktree-signals'
import type { PanelAdapterDeps } from '../integration-panels'

function depsWith(fetchImpl: (url: string) => Promise<Response>): PanelAdapterDeps {
  return { getToken: () => 'tok', getConfig: () => ({}), fetch: vi.fn(fetchImpl) } as unknown as PanelAdapterDeps
}
const runsResp = (concl: string | null, status = 'completed') =>
  new Response(JSON.stringify({ workflow_runs: [{ id: 9, name: 'CI', status, conclusion: concl, html_url: 'r', head_branch: 'feat/x' }] }), { status: 200 })
const noReviews = new Response('[]', { status: 200 })

describe('WorktreeSignals — CI por worktree', () => {
  it('poll resuelve el estado de CI del branch y lo expone por get()', async () => {
    const deps = depsWith(async (url) => {
      if (url.includes('/actions/runs')) return runsResp('failure')
      return noReviews
    })
    const s = new WorktreeSignals(() => 'acme/app')
    await s.poll([{ repoPath: '/wt/x', branch: 'feat/x' }], deps)
    expect(s.get('/wt/x')?.ci).toBe('failure')
  })

  it('salta worktrees cuyo remote no resuelve a owner/repo (no GitHub)', async () => {
    const fetchMock = vi.fn()
    const deps = { getToken: () => 'tok', getConfig: () => ({}), fetch: fetchMock } as unknown as PanelAdapterDeps
    const s = new WorktreeSignals(() => null)
    await s.poll([{ repoPath: '/wt/x', branch: 'feat/x' }], deps)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(s.get('/wt/x')).toBeUndefined()
  })
})
