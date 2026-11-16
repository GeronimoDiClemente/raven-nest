import { describe, it, expect, vi } from 'vitest'
import { createGitHubServerAdapter } from '../integrations/github'
import { NotConnectedError, type PanelAdapterDeps } from '../integration-panels'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

// Router de fetch mockeado: matchea por substring de la URL, en orden.
function routedFetch(routes: [string | RegExp, () => Response][]): typeof fetch {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    for (const [matcher, respond] of routes) {
      const hit = typeof matcher === 'string' ? url.includes(matcher) : matcher.test(url)
      if (hit) return Promise.resolve(respond())
    }
    throw new Error(`unmocked fetch: ${url}`)
  }) as unknown as typeof fetch
}

function makeDeps(fetchImpl: typeof fetch, token: string | null = 'gh-token'): PanelAdapterDeps {
  return { getToken: () => token, getConfig: () => ({}), fetch: fetchImpl }
}

const HTTPS_REMOTE = 'https://github.com/acme/widget.git'
const SSH_REMOTE = 'git@github.com:acme/widget.git'

describe('GitHub adapter — fetchSections', () => {
  it('mapea "Assigned to me" con accent #N y repo short name', async () => {
    const fetchImpl = routedFetch([
      ['/issues?filter=assigned', () => jsonResponse(200, [
        { number: 5, title: 'Fix crash', pull_request: undefined, repository: { full_name: 'acme/widget' } },
      ])],
    ])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => null)
    const sections = await adapter.fetchSections({ repoPath: null, branch: null })
    expect(sections).toEqual([
      { id: 'assigned', label: 'Assigned to me', items: [
        { id: 'issue:acme/widget:5', title: 'Fix crash', subtitle: 'widget', accent: '#5' },
      ] },
    ])
  })

  it('sin remote de GitHub, solo devuelve la sección global "Assigned to me"', async () => {
    const fetchImpl = routedFetch([
      ['/issues?filter=assigned', () => jsonResponse(200, [])],
    ])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => null)
    const sections = await adapter.fetchSections({ repoPath: '/repo', branch: null })
    expect(sections).toEqual([{ id: 'assigned', label: 'Assigned to me', items: [] }])
  })

  it('con remote, agrega "Open PRs" y "Recent issues" (filtrando PRs de /issues)', async () => {
    const fetchImpl = routedFetch([
      ['/issues?filter=assigned', () => jsonResponse(200, [])],
      ['/repos/acme/widget/pulls?state=open', () => jsonResponse(200, [
        { number: 10, title: 'Add feature', user: { login: 'dev1' } },
      ])],
      ['/repos/acme/widget/issues?state=open', () => jsonResponse(200, [
        { number: 11, title: 'Real issue', user: { login: 'dev2' } },
        { number: 12, title: 'This is actually a PR', pull_request: {}, user: { login: 'dev3' } },
      ])],
    ])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => HTTPS_REMOTE)
    const sections = await adapter.fetchSections({ repoPath: '/repo', branch: null })
    expect(sections).toEqual([
      { id: 'assigned', label: 'Assigned to me', items: [] },
      { id: 'prs', label: 'Open PRs', items: [
        { id: 'pr:acme/widget:10', title: 'Add feature', subtitle: 'by dev1', accent: '#10' },
      ] },
      { id: 'issues', label: 'Recent issues', items: [
        { id: 'issue:acme/widget:11', title: 'Real issue', subtitle: 'by dev2', accent: '#11' },
      ] },
    ])
  })

  it('soporta remote en formato ssh (git@github.com:owner/repo.git)', async () => {
    const fetchImpl = routedFetch([
      ['/issues?filter=assigned', () => jsonResponse(200, [])],
      ['/repos/acme/widget/pulls?state=open', () => jsonResponse(200, [])],
      ['/repos/acme/widget/issues?state=open', () => jsonResponse(200, [])],
    ])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => SSH_REMOTE)
    const sections = await adapter.fetchSections({ repoPath: '/repo', branch: null })
    expect(sections.map((s) => s.id)).toEqual(['assigned', 'prs', 'issues'])
  })
})

describe('GitHub adapter — fetchDetail', () => {
  it('mapea un issue: key, status, meta, body + comentarios', async () => {
    const fetchImpl = routedFetch([
      ['/repos/acme/widget/issues/7/comments', () => jsonResponse(200, [
        { user: { login: 'dev2' }, body: 'looking into it', created_at: new Date(Date.now() - 60_000).toISOString() },
      ])],
      ['/repos/acme/widget/issues/7', () => jsonResponse(200, {
        number: 7, title: 'Bug', body: 'It crashes', state: 'open',
        user: { login: 'author1' }, assignee: { login: 'dev1' }, assignees: [{ login: 'dev1' }],
        labels: ['bug', { name: 'p1' }],
      })],
    ])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => null)
    const detail = await adapter.fetchDetail({ sectionId: 'issues', itemId: 'issue:acme/widget:7' })
    expect(detail.key).toBe('#7')
    expect(detail.status).toBe('open')
    expect(detail.meta).toEqual([
      { label: 'Author', value: 'author1' },
      { label: 'Assignee', value: 'dev1' },
      { label: 'Labels', value: 'bug, p1' },
    ])
    expect(detail.blocks[0]).toEqual({ kind: 'text', text: 'It crashes' })
    expect(detail.blocks[1]).toMatchObject({ kind: 'comment', author: 'dev2', text: 'looking into it' })
  })

  it('mapea una PR mergeada como status "merged"', async () => {
    const fetchImpl = routedFetch([
      ['/repos/acme/widget/pulls/9', () => jsonResponse(200, {
        number: 9, title: 'Feature', body: 'desc', state: 'closed', merged_at: '2026-01-01T00:00:00Z',
        user: { login: 'author2' }, assignee: null, assignees: [], labels: [],
      })],
      ['/repos/acme/widget/issues/9/comments', () => jsonResponse(200, [])],
    ])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => null)
    const detail = await adapter.fetchDetail({ sectionId: 'prs', itemId: 'pr:acme/widget:9' })
    expect(detail.status).toBe('merged')
    expect(detail.meta).toEqual([
      { label: 'Author', value: 'author2' },
      { label: 'Assignee', value: '—' },
      { label: 'Labels', value: '—' },
    ])
  })

  it('solo toma los últimos 10 comentarios', async () => {
    const comments = Array.from({ length: 15 }, (_, i) => ({
      user: { login: `u${i}` }, body: `c${i}`, created_at: new Date().toISOString(),
    }))
    const fetchImpl = routedFetch([
      ['/repos/acme/widget/issues/1/comments', () => jsonResponse(200, comments)],
      ['/repos/acme/widget/issues/1', () => jsonResponse(200, {
        number: 1, title: 'T', body: '', state: 'open', user: null, assignee: null, assignees: [], labels: [],
      })],
    ])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => null)
    const detail = await adapter.fetchDetail({ sectionId: 'issues', itemId: 'issue:acme/widget:1' })
    const commentBlocks = detail.blocks.filter((b) => b.kind === 'comment')
    expect(commentBlocks).toHaveLength(10)
    expect(commentBlocks[0]).toMatchObject({ text: 'c5' })
  })
})

describe('GitHub adapter — resolveWorktreeEntity', () => {
  it('devuelve la PR cuyo head.ref matchea el branch', async () => {
    const fetchImpl = routedFetch([
      [/\/pulls\?head=acme:feature-x/, () => jsonResponse(200, [
        { number: 20, head: { ref: 'feature-x' } },
      ])],
    ])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => HTTPS_REMOTE)
    const ref = await adapter.resolveWorktreeEntity({ repoPath: '/repo', branch: 'feature-x' })
    expect(ref).toEqual({ sectionId: 'prs', itemId: 'pr:acme/widget:20' })
  })

  it('sin PR matcheada, cae al número dentro del nombre del branch', async () => {
    const fetchImpl = routedFetch([
      [/\/pulls\?head=/, () => jsonResponse(200, [])],
    ])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => HTTPS_REMOTE)
    const ref = await adapter.resolveWorktreeEntity({ repoPath: '/repo', branch: 'fix-issue-42' })
    expect(ref).toEqual({ sectionId: 'issues', itemId: 'issue:acme/widget:42' })
  })

  it('null si no hay branch, ni remote, ni número en el branch', async () => {
    const fetchImpl = routedFetch([])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => null)
    expect(await adapter.resolveWorktreeEntity({ repoPath: '/repo', branch: null })).toBeNull()
    expect(await adapter.resolveWorktreeEntity({ repoPath: null, branch: 'main' })).toBeNull()

    const fetchImpl2 = routedFetch([[/\/pulls\?head=/, () => jsonResponse(200, [])]])
    const adapter2 = createGitHubServerAdapter(makeDeps(fetchImpl2), () => HTTPS_REMOTE)
    expect(await adapter2.resolveWorktreeEntity({ repoPath: '/repo', branch: 'main' })).toBeNull()
  })
})

describe('GitHub adapter — actions', () => {
  const fetchImpl = routedFetch([])
  const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => null)

  it('issue open -> Close issue (primary)', () => {
    const detail = { ref: { sectionId: 'issues', itemId: 'issue:acme/widget:1' }, title: '', status: 'open', meta: [], blocks: [] }
    expect(adapter.actions(detail)).toEqual([{ id: 'close', label: 'Close issue', kind: 'primary' }])
  })

  it('issue closed -> Reopen', () => {
    const detail = { ref: { sectionId: 'issues', itemId: 'issue:acme/widget:1' }, title: '', status: 'closed', meta: [], blocks: [] }
    expect(adapter.actions(detail)).toEqual([{ id: 'reopen', label: 'Reopen', kind: 'secondary' }])
  })

  it('PR -> sin actions (merge fuera de alcance)', () => {
    const detail = { ref: { sectionId: 'prs', itemId: 'pr:acme/widget:1' }, title: '', status: 'open', meta: [], blocks: [] }
    expect(adapter.actions(detail)).toEqual([])
  })
})

describe('GitHub adapter — runAction', () => {
  it('close hace PATCH state=closed', async () => {
    const fetchImpl = routedFetch([
      ['/repos/acme/widget/issues/3', () => jsonResponse(200, {})],
    ])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => null)
    await adapter.runAction('close', { sectionId: 'issues', itemId: 'issue:acme/widget:3' })
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toContain('/repos/acme/widget/issues/3')
    expect(call[1].method).toBe('PATCH')
    expect(JSON.parse(call[1].body)).toEqual({ state: 'closed' })
  })

  it('reopen hace PATCH state=open', async () => {
    const fetchImpl = routedFetch([
      ['/repos/acme/widget/issues/3', () => jsonResponse(200, {})],
    ])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => null)
    await adapter.runAction('reopen', { sectionId: 'issues', itemId: 'issue:acme/widget:3' })
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(JSON.parse(call[1].body)).toEqual({ state: 'open' })
  })
})

describe('GitHub adapter — compose', () => {
  it('postea un comentario con texto + terminalOutput en code fence', async () => {
    const fetchImpl = routedFetch([
      ['/repos/acme/widget/issues/3/comments', () => jsonResponse(201, {})],
    ])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => null)
    await adapter.compose({ sectionId: 'issues', itemId: 'issue:acme/widget:3' }, { text: 'ver esto', terminalOutput: 'npm test\nok' })
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toContain('/repos/acme/widget/issues/3/comments')
    expect(call[1].method).toBe('POST')
    expect(JSON.parse(call[1].body)).toEqual({ body: 'ver esto\n```\nnpm test\nok\n```' })
  })

  it('sin terminalOutput, postea solo el texto', async () => {
    const fetchImpl = routedFetch([
      ['/repos/acme/widget/issues/3/comments', () => jsonResponse(201, {})],
    ])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => null)
    await adapter.compose({ sectionId: 'issues', itemId: 'issue:acme/widget:3' }, { text: 'solo texto' })
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(JSON.parse(call[1].body)).toEqual({ body: 'solo texto' })
  })
})

describe('GitHub adapter — auth errors', () => {
  it('401 de la API -> NotConnectedError', async () => {
    const fetchImpl = routedFetch([
      ['/issues?filter=assigned', () => jsonResponse(401, { message: 'Bad credentials' })],
    ])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => null)
    await expect(adapter.fetchSections({ repoPath: null, branch: null })).rejects.toBeInstanceOf(NotConnectedError)
  })

  it('sin token -> NotConnectedError sin llamar a fetch', async () => {
    const fetchImpl = vi.fn()
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl as unknown as typeof fetch, null), () => null)
    await expect(adapter.fetchSections({ repoPath: null, branch: null })).rejects.toBeInstanceOf(NotConnectedError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('error genérico de la API -> Error con status', async () => {
    const fetchImpl = routedFetch([
      ['/issues?filter=assigned', () => jsonResponse(500, { message: 'boom' })],
    ])
    const adapter = createGitHubServerAdapter(makeDeps(fetchImpl), () => null)
    await expect(adapter.fetchSections({ repoPath: null, branch: null })).rejects.toThrow(/500/)
  })
})
