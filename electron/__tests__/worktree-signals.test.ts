import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
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
    const emit = vi.fn(async (_ev: unknown, _deps: unknown) => ({ commands: [], failed: [] }))
    const s = new WorktreeSignals(() => 'acme/app')
    s.attachBus({ emit } as unknown as import('../integrations/event-bus').EventBus)
    const wts = [{ repoPath: '/wt/x', branch: 'feat/x' }]
    await s.poll(wts, deps)
    await s.poll(wts, deps) // mismo SHA rojo
    const ciFailed = emit.mock.calls.filter((c) => (c[0] as { type: string }).type === 'ci.failed')
    expect(ciFailed).toHaveLength(1)
  })

  it('el dedup de ci.failed persiste entre reinicios (no spamea al arrancar)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsig-')); const file = join(dir, 'signals.json')
    try {
      const rojo = () => new Response(JSON.stringify({ workflow_runs: [
        { id: 9, name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'r', head_branch: 'feat/x', head_sha: 'S' } ] }), { status: 200 })
      const deps = depsWith(async (u) => u.includes('/actions/runs') ? rojo() : new Response('[]', { status: 200 }))
      const emit1 = vi.fn(async (_e: unknown, _d: unknown) => ({ commands: [], failed: [] }))
      const s1 = new WorktreeSignals(() => 'acme/app'); s1.attachStorage(file); s1.attachBus({ emit: emit1 } as never)
      await s1.poll([{ repoPath: '/wt/x', branch: 'feat/x' }], deps)
      expect(emit1.mock.calls.filter(c => (c[0] as { type: string }).type === 'ci.failed')).toHaveLength(1)
      const emit2 = vi.fn(async (_e: unknown, _d: unknown) => ({ commands: [], failed: [] }))
      const s2 = new WorktreeSignals(() => 'acme/app'); s2.attachStorage(file); s2.attachBus({ emit: emit2 } as never)
      await s2.poll([{ repoPath: '/wt/x', branch: 'feat/x' }], deps) // restart, mismo SHA rojo
      expect(emit2.mock.calls.filter(c => (c[0] as { type: string }).type === 'ci.failed')).toHaveLength(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('el dedup de review.requested persiste entre reinicios (no re-notifica el mismo PR)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsig-')); const file = join(dir, 'signals.json')
    try {
      const deps = depsWith(async (u) => u.includes('/search/issues')
        ? new Response(JSON.stringify({ items: [{ number: 11, title: 'Fix A', repository_url: 'https://api.github.com/repos/acme/app' }] }), { status: 200 })
        : new Response('[]', { status: 200 }))
      const emit1 = vi.fn(async (_e: unknown, _d: unknown) => ({ commands: [], failed: [] }))
      const s1 = new WorktreeSignals(() => 'acme/app'); s1.attachStorage(file); s1.attachBus({ emit: emit1 } as never)
      await s1.pollReviewRequests(deps)
      expect(emit1.mock.calls.filter(c => (c[0] as { type: string }).type === 'review.requested')).toHaveLength(1)
      const emit2 = vi.fn(async (_e: unknown, _d: unknown) => ({ commands: [], failed: [] }))
      const s2 = new WorktreeSignals(() => 'acme/app'); s2.attachStorage(file); s2.attachBus({ emit: emit2 } as never)
      await s2.pollReviewRequests(deps) // restart, mismo PR
      expect(emit2.mock.calls.filter(c => (c[0] as { type: string }).type === 'review.requested')).toHaveLength(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('ci.failed SÍ re-emite ante un SHA rojo NUEVO (no dedupea entre commits distintos)', async () => {
    let sha = 'A'
    const deps = depsWith(async (url) => {
      if (url.includes('/actions/runs')) return new Response(JSON.stringify({ workflow_runs: [
        { id: 9, name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'r', head_branch: 'feat/x', head_sha: sha } ] }), { status: 200 })
      return new Response('[]', { status: 200 })
    })
    const emit = vi.fn(async (_e: unknown, _d: unknown) => ({ commands: [], failed: [] }))
    const s = new WorktreeSignals(() => 'acme/app'); s.attachBus({ emit } as never)
    const wts = [{ repoPath: '/wt/x', branch: 'feat/x' }]
    await s.poll(wts, deps)   // rojo shaA
    sha = 'B'
    await s.poll(wts, deps)   // rojo shaB (nuevo commit sigue rojo)
    expect(emit.mock.calls.filter(c => (c[0] as { type: string }).type === 'ci.failed')).toHaveLength(2)
  })

  it('changes.requested re-emite tras un reset (CHANGES_REQUESTED → APPROVED → CHANGES_REQUESTED)', async () => {
    let state = 'CHANGES_REQUESTED'
    const deps = depsWith(async (url) => {
      if (url.includes('/actions/runs')) return runsResp('success')
      if (url.includes('/pulls?')) return prResp(7)
      if (url.includes('/reviews')) return new Response(JSON.stringify([{ user: { login: 'a' }, state, submitted_at: '2026-01-02T00:00:00Z' }]), { status: 200 })
      return new Response('[]', { status: 200 })
    })
    const emit = vi.fn(async (_e: unknown, _d: unknown) => ({ commands: [], failed: [] }))
    const s = new WorktreeSignals(() => 'acme/app'); s.attachBus({ emit } as never)
    const wts = [{ repoPath: '/wt/x', branch: 'feat/x' }]
    await s.poll(wts, deps)   // CHANGES_REQUESTED → emite (1)
    state = 'APPROVED'
    await s.poll(wts, deps)   // reset a approved → no emite
    state = 'CHANGES_REQUESTED'
    await s.poll(wts, deps)   // vuelve a pedir cambios → re-emite (2)
    expect(emit.mock.calls.filter(c => (c[0] as { type: string }).type === 'changes.requested')).toHaveLength(2)
  })

  it('NO emite ci.failed ni marca runId si el run más reciente está verde (aunque haya uno viejo rojo)', async () => {
    const deps = depsWith(async (url) => {
      if (url.includes('/actions/runs')) return new Response(JSON.stringify({ workflow_runs: [
        { id: 2, name: 'CI', status: 'completed', conclusion: 'success', html_url: 'b', head_branch: 'feat/x', head_sha: 'B' },
        { id: 1, name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'a', head_branch: 'feat/x', head_sha: 'A' },
      ] }), { status: 200 })
      return new Response('[]', { status: 200 })
    })
    const emit = vi.fn(async (_e: unknown, _d: unknown) => ({ commands: [], failed: [] }))
    const s = new WorktreeSignals(() => 'acme/app'); s.attachBus({ emit } as never)
    await s.poll([{ repoPath: '/wt/x', branch: 'feat/x' }], deps)
    expect(s.get('/wt/x')?.ci).toBe('success')
    expect(s.get('/wt/x')?.runId).toBeUndefined()
    expect(emit.mock.calls.filter(c => (c[0] as { type: string }).type === 'ci.failed')).toHaveLength(0)
  })

  it('emite changes.requested cuando el PR pasa a CHANGES_REQUESTED, una sola vez', async () => {
    let state = 'APPROVED'
    const deps = depsWith(async (url) => {
      if (url.includes('/actions/runs')) return runsResp('success')
      if (url.includes('/pulls?')) return prResp(7)
      if (url.includes('/reviews')) return new Response(JSON.stringify([{ user: { login: 'a' }, state, submitted_at: '2026-01-02T00:00:00Z' }]), { status: 200 })
      return new Response('[]', { status: 200 })
    })
    const emit = vi.fn(async (_ev: unknown, _deps: unknown) => ({ commands: [], failed: [] }))
    const s = new WorktreeSignals(() => 'acme/app')
    s.attachBus({ emit } as unknown as import('../integrations/event-bus').EventBus)
    const wts = [{ repoPath: '/wt/x', branch: 'feat/x' }]
    await s.poll(wts, deps)                       // APPROVED → no emite
    state = 'CHANGES_REQUESTED'
    await s.poll(wts, deps)                       // transición → emite
    await s.poll(wts, deps)                       // sigue en CHANGES_REQUESTED → no re-emite
    const cr = emit.mock.calls.filter((c) => (c[0] as { type: string }).type === 'changes.requested')
    expect(cr).toHaveLength(1)
    expect(cr[0][0]).toMatchObject({ type: 'changes.requested', branch: 'feat/x', repoFullName: 'acme/app', prNumber: 7 })
  })

  it('emite review.requested por cada PR nuevo del search, sin repetir', async () => {
    // Response fresca por llamada: un único Response se consumiría al primer
    // .json() y la 2da poll tiraría "body used already" en vez de testear dedup.
    const deps = depsWith(async (url) => {
      if (url.includes('/search/issues')) return new Response(JSON.stringify({ items: [
        { number: 11, title: 'Fix A', repository_url: 'https://api.github.com/repos/acme/app' },
      ] }), { status: 200 })
      return new Response('[]', { status: 200 })
    })
    const emit = vi.fn(async (_ev: unknown, _deps: unknown) => ({ commands: [], failed: [] }))
    const s = new WorktreeSignals(() => 'acme/app')
    s.attachBus({ emit } as unknown as import('../integrations/event-bus').EventBus)
    await s.pollReviewRequests(deps)
    await s.pollReviewRequests(deps) // mismo PR → no re-emite
    const rr = emit.mock.calls.filter((c) => (c[0] as { type: string }).type === 'review.requested')
    expect(rr).toHaveLength(1)
    expect(rr[0][0]).toMatchObject({ type: 'review.requested', repoFullName: 'acme/app', prNumber: 11, prTitle: 'Fix A' })
  })

  it('un fallo transitorio del fetch de runs NO pisa el estado rojo previo', async () => {
    let firstRun = true
    const deps = depsWith(async (url) => {
      if (url.includes('/actions/runs')) {
        if (firstRun) { firstRun = false; return new Response(JSON.stringify({ workflow_runs: [
          { id: 9, name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'r', head_branch: 'feat/x', head_sha: 'S' } ] }), { status: 200 }) }
        return new Response('boom', { status: 500 }) // blip
      }
      return new Response('[]', { status: 200 })
    })
    const s = new WorktreeSignals(() => 'acme/app')
    const wts = [{ repoPath: '/wt/x', branch: 'feat/x' }]
    await s.poll(wts, deps)                     // rojo
    expect(s.get('/wt/x')?.ci).toBe('failure')
    await s.poll(wts, deps)                     // blip 500
    expect(s.get('/wt/x')?.ci).toBe('failure')  // retiene el estado bueno
    expect(s.get('/wt/x')?.runId).toBe(9)
  })

  it('un blip del fetch de PRs (500) NO borra changesRequested ni prNumber', async () => {
    let prsUp = true
    const deps = depsWith(async (url) => {
      if (url.includes('/actions/runs')) return runsResp('success')
      if (url.includes('/pulls?')) return prsUp ? prResp(42) : new Response('boom', { status: 500 }) // blip
      if (url.includes('/reviews')) return reviewsResp('CHANGES_REQUESTED')
      return new Response('[]', { status: 200 })
    })
    const s = new WorktreeSignals(() => 'acme/app')
    const wts = [{ repoPath: '/wt/x', branch: 'feat/x' }]
    await s.poll(wts, deps)                                              // establece PR + changes-requested
    expect(s.get('/wt/x')).toMatchObject({ changesRequested: true, prNumber: 42 })
    prsUp = false
    await s.poll(wts, deps)                                              // blip 500 en /pulls
    expect(s.get('/wt/x')).toMatchObject({ ci: 'success', changesRequested: true, prNumber: 42 })
  })

  it('review.requested no colisiona entre repos con el mismo número de PR', async () => {
    const items = [
      { number: 5, title: 'A', repository_url: 'https://api.github.com/repos/acme/app' },
      { number: 5, title: 'B', repository_url: 'https://api.github.com/repos/acme/other' },
    ]
    const deps = depsWith(async (url) => url.includes('/search/issues')
      ? new Response(JSON.stringify({ items }), { status: 200 }) : new Response('[]', { status: 200 }))
    const emit = vi.fn(async (_e: unknown, _d: unknown) => ({ commands: [], failed: [] }))
    const s = new WorktreeSignals(() => 'acme/app'); s.attachBus({ emit } as never)
    await s.pollReviewRequests(deps)
    expect(emit.mock.calls.filter(c => (c[0] as { type: string }).type === 'review.requested')).toHaveLength(2)
  })

  it('fixCiPrompt arma prompt con el título del run, la URL y el log truncado', async () => {
    const bigLog = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n')
    const deps = depsWith(async (url) => {
      if (url.includes('/actions/runs?')) return new Response(JSON.stringify({ workflow_runs: [
        { id: 77, name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'https://run', head_branch: 'feat/x', head_sha: 's' },
      ] }), { status: 200 })
      if (url.endsWith('/runs/77/jobs')) return new Response(JSON.stringify({ jobs: [
        { id: 5, conclusion: 'success' }, { id: 6, conclusion: 'failure' },
      ] }), { status: 200 })
      if (url.endsWith('/jobs/6/logs')) return new Response(bigLog, { status: 200 })
      return new Response('[]', { status: 200 })
    })
    const s = new WorktreeSignals(() => 'acme/app')
    await s.poll([{ repoPath: '/wt/x', branch: 'feat/x' }], deps)
    const prompt = await s.fixCiPrompt('/wt/x', deps)
    expect(prompt).toContain('https://run')
    expect(prompt).toContain('line 299')       // últimas líneas presentes
    expect(prompt).not.toContain('line 99')     // truncado (fuera de las últimas 200)
  })

  it('fixCiPrompt devuelve null si el worktree no tiene run rojo', async () => {
    const s = new WorktreeSignals(() => 'acme/app')
    expect(await s.fixCiPrompt('/desconocido', depsWith(async () => new Response('{}', { status: 200 })))).toBeNull()
  })
})
