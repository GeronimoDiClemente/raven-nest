import { describe, it, expect, vi } from 'vitest'
import { createJiraServerAdapter, adfToBlocks, type AdfNode } from '../integrations/jira'
import { callPanel, registerPanelAdapter, resetPanelAdapters, type PanelAdapterDeps } from '../integration-panels'

const CREDS = JSON.stringify({ email: 'me@co.com', apiToken: 'tok-1', siteUrl: 'https://co.atlassian.net/' })

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

// Router simple: cada test arma un mapa method+path (sin host) → responder.
// `fetchSpy` guarda todas las llamadas para inspeccionar URL/headers/body.
function makeFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init)))
}

function makeDeps(fetchImpl: ReturnType<typeof makeFetch>, token: string | null = CREDS): PanelAdapterDeps {
  return { getToken: () => token, getConfig: () => ({}), fetch: fetchImpl as unknown as typeof fetch }
}

describe('adfToBlocks', () => {
  it('convierte paragraphs y headings en bloques de texto', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }] },
      ],
    }
    expect(adfToBlocks(doc)).toEqual([
      { kind: 'text', text: 'Title' },
      { kind: 'text', text: 'Hello world' },
    ])
  })

  it('convierte codeBlock con language a bloque code', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [{ type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1' }] }],
    }
    expect(adfToBlocks(doc)).toEqual([{ kind: 'code', code: 'const x = 1', tag: 'ts' }])
  })

  it('recorre listas anidadas (bulletList > listItem > paragraph)', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item 1' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item 2' }] }] },
          ],
        },
      ],
    }
    expect(adfToBlocks(doc)).toEqual([
      { kind: 'text', text: 'item 1' },
      { kind: 'text', text: 'item 2' },
    ])
  })

  it('doc vacío o null devuelve []', () => {
    expect(adfToBlocks(null)).toEqual([])
    expect(adfToBlocks({ type: 'doc' })).toEqual([])
  })
})

describe('createJiraServerAdapter — fetchSections', () => {
  it('arma JQL de "My work" y "Recently updated" con los fields esperados', async () => {
    const fetchSpy = makeFetch((url) => {
      const jql = new URL(url).searchParams.get('jql') ?? ''
      if (jql.startsWith('assignee = currentUser()')) {
        return jsonResponse(200, { issues: [{ key: 'ABC-1', fields: { summary: 'Fix bug', status: { name: 'In Progress' } } }] })
      }
      return jsonResponse(200, { issues: [{ key: 'ABC-2', fields: { summary: 'Old ticket', status: { name: 'Done' } } }] })
    })
    const adapter = createJiraServerAdapter(makeDeps(fetchSpy))
    const sections = await adapter.fetchSections({ repoPath: null, branch: null })

    expect(sections).toEqual([
      { id: 'mine', label: 'My work', items: [{ id: 'ABC-1', title: 'Fix bug', subtitle: 'In Progress', accent: 'ABC-1' }] },
      { id: 'recent', label: 'Recently updated', items: [{ id: 'ABC-2', title: 'Old ticket', subtitle: 'Done', accent: 'ABC-2' }] },
    ])

    const urls = fetchSpy.mock.calls.map((c) => new URL(c[0] as string))
    expect(urls[0].origin + urls[0].pathname).toBe('https://co.atlassian.net/rest/api/3/search')
    expect(urls[0].searchParams.get('jql')).toBe('assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC')
    expect(urls[0].searchParams.get('fields')).toBe('summary,status,priority,key')
    expect(urls[0].searchParams.get('maxResults')).toBeNull()
    expect(urls[1].searchParams.get('jql')).toBe('ORDER BY updated DESC')
    expect(urls[1].searchParams.get('maxResults')).toBe('10')
  })

  it('usa Basic auth con base64(email:apiToken)', async () => {
    const fetchSpy = makeFetch(() => jsonResponse(200, { issues: [] }))
    const adapter = createJiraServerAdapter(makeDeps(fetchSpy))
    await adapter.fetchSections({ repoPath: null, branch: null })
    const headers = fetchSpy.mock.calls[0][1]?.headers as unknown as Record<string, string>
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('me@co.com:tok-1').toString('base64')}`)
  })
})

describe('createJiraServerAdapter — fetchDetail', () => {
  it('mapea issue + comentarios ADF + guarda transitions para actions()', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/transitions')) {
        return jsonResponse(200, {
          transitions: [
            { id: '11', name: 'In Progress' },
            { id: '21', name: 'Done' },
            { id: '31', name: 'Blocked' },
            { id: '41', name: 'Cancelled' },
          ],
        })
      }
      return jsonResponse(200, {
        key: 'ABC-1',
        fields: {
          summary: 'Fix bug',
          status: { name: 'In Progress' },
          priority: { name: 'High' },
          assignee: { displayName: 'Ada' },
          description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Steps to repro' }] }] },
          comment: {
            comments: [
              {
                author: { displayName: 'Bob' },
                created: new Date().toISOString(),
                body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'lgtm' }] }] },
              },
            ],
          },
        },
      })
    })
    const adapter = createJiraServerAdapter(makeDeps(fetchSpy))
    const detail = await adapter.fetchDetail({ sectionId: 'mine', itemId: 'ABC-1' })

    expect(detail.key).toBe('ABC-1')
    expect(detail.status).toBe('In Progress')
    expect(detail.meta).toEqual([
      { label: 'Assignee', value: 'Ada' },
      { label: 'Priority', value: 'High' },
    ])
    expect(detail.blocks[0]).toEqual({ kind: 'text', text: 'Steps to repro' })
    expect(detail.blocks[1]).toMatchObject({ kind: 'comment', author: 'Bob', text: 'lgtm' })

    // actions() lee el cache poblado durante fetchDetail — cap 3, primera primary
    const actions = adapter.actions(detail)
    expect(actions).toEqual([
      { id: '11', label: '→ In Progress', kind: 'primary' },
      { id: '21', label: '→ Done', kind: 'secondary' },
      { id: '31', label: '→ Blocked', kind: 'secondary' },
    ])
  })
})

describe('createJiraServerAdapter — resolveWorktreeEntity', () => {
  it('extrae la clave del branch y confirma que existe con un GET', async () => {
    const fetchSpy = makeFetch((url) => {
      expect(url).toContain('/issue/RAV-42')
      return jsonResponse(200, { key: 'RAV-42', fields: {} })
    })
    const adapter = createJiraServerAdapter(makeDeps(fetchSpy))
    const ref = await adapter.resolveWorktreeEntity({ repoPath: null, branch: 'feature/RAV-42-fix-thing' })
    expect(ref).toEqual({ sectionId: 'mine', itemId: 'RAV-42' })
  })

  it('devuelve null si el GET de confirmación da 404', async () => {
    const fetchSpy = makeFetch(() => jsonResponse(404, {}))
    const adapter = createJiraServerAdapter(makeDeps(fetchSpy))
    const ref = await adapter.resolveWorktreeEntity({ repoPath: null, branch: 'feature/RAV-42-fix-thing' })
    expect(ref).toBeNull()
  })

  it('devuelve null sin llamar a fetch si el branch no tiene clave', async () => {
    const fetchSpy = makeFetch(() => jsonResponse(200, {}))
    const adapter = createJiraServerAdapter(makeDeps(fetchSpy))
    const ref = await adapter.resolveWorktreeEntity({ repoPath: null, branch: 'feature/no-key-here' })
    expect(ref).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('createJiraServerAdapter — runAction / compose', () => {
  it('runAction postea el id de la transition', async () => {
    const fetchSpy = makeFetch(() => jsonResponse(204, {}))
    const adapter = createJiraServerAdapter(makeDeps(fetchSpy))
    await adapter.runAction('21', { sectionId: 'mine', itemId: 'ABC-1' })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain('/issue/ABC-1/transitions')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ transition: { id: '21' } })
  })

  it('compose arma un doc ADF con paragraph + codeBlock del terminalOutput', async () => {
    const fetchSpy = makeFetch(() => jsonResponse(201, {}))
    const adapter = createJiraServerAdapter(makeDeps(fetchSpy))
    await adapter.compose({ sectionId: 'mine', itemId: 'ABC-1' }, { text: 'listo', terminalOutput: '$ npm test' })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain('/issue/ABC-1/comment')
    const payload = JSON.parse(init?.body as string)
    expect(payload.body).toEqual({
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'listo' }] },
        { type: 'codeBlock', content: [{ type: 'text', text: '$ npm test' }] },
      ],
    })
  })
})

describe('createJiraServerAdapter — errores', () => {
  it('401 se mapea a NOT_CONNECTED vía el host callPanel', async () => {
    resetPanelAdapters()
    registerPanelAdapter('jira', createJiraServerAdapter)
    const fetchSpy = makeFetch(() => jsonResponse(401, {}))
    const res = await callPanel('jira', 'fetchSections', [{ repoPath: null, branch: null }], makeDeps(fetchSpy))
    expect(res).toEqual({ ok: false, error: 'NOT_CONNECTED' })
  })

  it('403 también se mapea a NOT_CONNECTED', async () => {
    resetPanelAdapters()
    registerPanelAdapter('jira', createJiraServerAdapter)
    const fetchSpy = makeFetch(() => jsonResponse(403, {}))
    const res = await callPanel('jira', 'fetchSections', [{ repoPath: null, branch: null }], makeDeps(fetchSpy))
    expect(res).toEqual({ ok: false, error: 'NOT_CONNECTED' })
  })

  it('credencial faltante → NOT_CONNECTED', async () => {
    resetPanelAdapters()
    registerPanelAdapter('jira', createJiraServerAdapter)
    const fetchSpy = makeFetch(() => jsonResponse(200, { issues: [] }))
    const res = await callPanel('jira', 'fetchSections', [{ repoPath: null, branch: null }], makeDeps(fetchSpy, null))
    expect(res).toEqual({ ok: false, error: 'NOT_CONNECTED' })
  })

  it('credencial con JSON roto → NOT_CONNECTED', async () => {
    resetPanelAdapters()
    registerPanelAdapter('jira', createJiraServerAdapter)
    const fetchSpy = makeFetch(() => jsonResponse(200, { issues: [] }))
    const res = await callPanel('jira', 'fetchSections', [{ repoPath: null, branch: null }], makeDeps(fetchSpy, 'not-json'))
    expect(res).toEqual({ ok: false, error: 'NOT_CONNECTED' })
  })

  it('credencial incompleta (sin siteUrl) → NOT_CONNECTED', async () => {
    resetPanelAdapters()
    registerPanelAdapter('jira', createJiraServerAdapter)
    const fetchSpy = makeFetch(() => jsonResponse(200, { issues: [] }))
    const bad = JSON.stringify({ email: 'me@co.com', apiToken: 'tok-1' })
    const res = await callPanel('jira', 'fetchSections', [{ repoPath: null, branch: null }], makeDeps(fetchSpy, bad))
    expect(res).toEqual({ ok: false, error: 'NOT_CONNECTED' })
  })

  it('un 500 genérico se mapea a API_ERROR', async () => {
    resetPanelAdapters()
    registerPanelAdapter('jira', createJiraServerAdapter)
    const fetchSpy = makeFetch(() => jsonResponse(500, {}))
    const res = await callPanel('jira', 'fetchSections', [{ repoPath: null, branch: null }], makeDeps(fetchSpy))
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error).toBe('API_ERROR')
  })
})
