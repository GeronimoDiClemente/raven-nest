import { describe, it, expect, vi } from 'vitest'
import { WorktreeSignals } from '../integrations/worktree-signals'
import type { PanelAdapterDeps } from '../integration-panels'

function depsWith(fetchImpl: (url: string) => Promise<Response>): PanelAdapterDeps {
  return { getToken: () => 'tok', getConfig: () => ({}), fetch: vi.fn(fetchImpl) } as unknown as PanelAdapterDeps
}
const runsResp = (concl: string | null, status = 'completed') =>
  new Response(JSON.stringify({ workflow_runs: [{ id: 9, name: 'CI', status, conclusion: concl, html_url: 'r', head_branch: 'feat/x' }] }), { status: 200 })
const noReviews = new Response('[]', { status: 200 })
const prResp = (n: number) => new Response(JSON.stringify([{ number: n, head: { ref: 'feat/x' } }]), { status: 200 })
const reviewsResp = (state: string) => new Response(JSON.stringify([
  { user: { login: 'a' }, state: 'COMMENTED', submitted_at: '2026-01-01T00:00:00Z' },
  { user: { login: 'a' }, state, submitted_at: '2026-01-02T00:00:00Z' },
]), { status: 200 })

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

  it('detecta changes_requested del review más reciente por autor', async () => {
    const deps = depsWith(async (url) => {
      if (url.includes('/actions/runs')) return runsResp('success')
      if (url.includes('/pulls?')) return prResp(42)
      if (url.includes('/reviews')) return reviewsResp('CHANGES_REQUESTED')
      return new Response('[]', { status: 200 })
    })
    const s = new WorktreeSignals(() => 'acme/app')
    await s.poll([{ repoPath: '/wt/x', branch: 'feat/x' }], deps)
    expect(s.get('/wt/x')).toMatchObject({ changesRequested: true, prNumber: 42 })
  })

  it('emite ci.failed una sola vez por SHA rojo (dedup)', async () => {
    const deps = depsWith(async (url) => {
      if (url.includes('/actions/runs')) return new Response(JSON.stringify({ workflow_runs: [
        { id: 9, name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'r', head_branch: 'feat/x', head_sha: 'abc' },
      ] }), { status: 200 })
      return new Response('[]', { status: 200 })
    })
    const emit = vi.fn(async () => ({ commands: [], failed: [] }))
    const s = new WorktreeSignals(() => 'acme/app')
    s.attachBus({ emit } as unknown as import('../integrations/event-bus').EventBus)
    const wts = [{ repoPath: '/wt/x', branch: 'feat/x' }]
    await s.poll(wts, deps)
    await s.poll(wts, deps) // mismo SHA rojo
    const ciFailed = emit.mock.calls.filter((c) => (c[0] as { type: string }).type === 'ci.failed')
    expect(ciFailed).toHaveLength(1)
  })
})
