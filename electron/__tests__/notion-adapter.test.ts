import { describe, it, expect, vi } from 'vitest'
import {
  createNotionServerAdapter, pageTitle, notionBlocksToDetail, parseNotionToken,
} from '../integrations/notion'
import { NotConnectedError, type PanelAdapterDeps } from '../integration-panels'

function jsonResponse(body: unknown, init: { status?: number; ok?: boolean } = {}): Response {
  const status = init.status ?? 200
  return {
    status,
    ok: init.ok ?? (status >= 200 && status < 300),
    json: async () => body,
  } as unknown as Response
}

function makeDeps(overrides: Partial<PanelAdapterDeps> = {}): PanelAdapterDeps {
  return {
    getToken: () => JSON.stringify({ token: 'secret_abc' }),
    getConfig: () => ({}),
    fetch: vi.fn(async () => jsonResponse({})) as unknown as typeof fetch,
    ...overrides,
  }
}

describe('pageTitle', () => {
  it('extrae el título de una página desde la property de tipo title', () => {
    const page = {
      object: 'page' as const,
      id: 'p1',
      properties: {
        Name: { type: 'title', title: [{ plain_text: 'Hola ' }, { plain_text: 'mundo' }] },
        Status: { type: 'select' },
      },
    }
    expect(pageTitle(page)).toBe('Hola mundo')
  })

  it('devuelve "Untitled" si la property title tiene el array vacío', () => {
    const page = {
      object: 'page' as const,
      id: 'p2',
      properties: { Name: { type: 'title', title: [] } },
    }
    expect(pageTitle(page)).toBe('Untitled')
  })

  it('devuelve "Untitled" si no hay ninguna property de tipo title', () => {
    const page = { object: 'page' as const, id: 'p3', properties: {} }
    expect(pageTitle(page)).toBe('Untitled')
  })

  it('extrae el título top-level de una database', () => {
    const db = { object: 'database' as const, id: 'd1', title: [{ plain_text: 'Roadmap' }] }
    expect(pageTitle(db)).toBe('Roadmap')
  })

  it('devuelve "Untitled database" si el título de la database está vacío', () => {
    const db = { object: 'database' as const, id: 'd2', title: [] }
    expect(pageTitle(db)).toBe('Untitled database')
  })
})

describe('notionBlocksToDetail', () => {
  it('mapea paragraph a un text block', () => {
    const blocks = [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Hola' }] } }]
    expect(notionBlocksToDetail(blocks)).toEqual([{ kind: 'text', text: 'Hola' }])
  })

  it('prefija headings con # / ## / ###', () => {
    const blocks = [
      { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Título' }] } },
      { type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Subtítulo' }] } },
      { type: 'heading_3', heading_3: { rich_text: [{ plain_text: 'Sub-sub' }] } },
    ]
    expect(notionBlocksToDetail(blocks)).toEqual([
      { kind: 'text', text: '# Título' },
      { kind: 'text', text: '## Subtítulo' },
      { kind: 'text', text: '### Sub-sub' },
    ])
  })

  it('mapea code a un code block con el lenguaje como tag', () => {
    const blocks = [{ type: 'code', code: { rich_text: [{ plain_text: 'echo hi' }], language: 'bash' } }]
    expect(notionBlocksToDetail(blocks)).toEqual([{ kind: 'code', code: 'echo hi', tag: 'bash' }])
  })

  it('mapea bulleted y numbered list items a text blocks', () => {
    const blocks = [
      { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: 'uno' }] } },
      { type: 'numbered_list_item', numbered_list_item: { rich_text: [{ plain_text: 'dos' }] } },
      { type: 'numbered_list_item', numbered_list_item: { rich_text: [{ plain_text: 'tres' }] } },
    ]
    expect(notionBlocksToDetail(blocks)).toEqual([
      { kind: 'text', text: '• uno' },
      { kind: 'text', text: '1. dos' },
      { kind: 'text', text: '2. tres' },
    ])
  })

  it('saltea tipos no soportados (p.ej. image)', () => {
    const blocks = [
      { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'antes' }] } },
      { type: 'image', image: { file: { url: 'https://x' } } },
      { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'después' }] } },
    ]
    expect(notionBlocksToDetail(blocks)).toEqual([
      { kind: 'text', text: 'antes' },
      { kind: 'text', text: 'después' },
    ])
  })
})

describe('parseNotionToken', () => {
  it('extrae el token de la forma JSON guardada por el form de Connect', () => {
    expect(parseNotionToken(JSON.stringify({ token: 'secret_xyz' }))).toBe('secret_xyz')
  })

  it('usa el string crudo como token si no es JSON válido', () => {
    expect(parseNotionToken('secret_raw')).toBe('secret_raw')
  })
})

describe('createNotionServerAdapter', () => {
  it('fetchSections separa "Recent pages" y "Databases" y extrae títulos', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      results: [
        {
          object: 'page', id: 'p1', last_edited_time: '2026-07-01T10:00:00.000Z',
          properties: { Name: { type: 'title', title: [{ plain_text: 'Nota 1' }] } },
        },
        { object: 'database', id: 'd1', last_edited_time: '2026-07-02T10:00:00.000Z', title: [{ plain_text: 'DB 1' }] },
        {
          object: 'page', id: 'p2', last_edited_time: '2026-07-03T10:00:00.000Z',
          properties: { Name: { type: 'title', title: [] } },
        },
      ],
    }))
    const deps = makeDeps({ fetch: fetchMock as unknown as typeof fetch })
    const adapter = createNotionServerAdapter(deps)
    const sections = await adapter.fetchSections({ repoPath: null, branch: null })

    expect(sections).toEqual([
      {
        id: 'recent', label: 'Recent pages',
        items: [
          { id: 'p1', title: 'Nota 1', subtitle: '2026-07-01' },
          { id: 'p2', title: 'Untitled', subtitle: '2026-07-03' },
        ],
      },
      { id: 'databases', label: 'Databases', items: [{ id: 'd1', title: 'DB 1', subtitle: '2026-07-02' }] },
    ])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.notion.com/v1/search')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe('Bearer secret_abc')
    expect((init as RequestInit & { headers: Record<string, string> }).headers['Notion-Version']).toBe('2022-06-28')
  })

  it('fetchDetail de una página combina /pages/{id} y /blocks/{id}/children', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/pages/')) {
        return jsonResponse({
          object: 'page', id: 'p1',
          created_time: '2026-06-01T00:00:00.000Z',
          last_edited_time: '2026-07-01T00:00:00.000Z',
          properties: { Name: { type: 'title', title: [{ plain_text: 'Nota 1' }] } },
        })
      }
      return jsonResponse({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'contenido' }] } }] })
    })
    const deps = makeDeps({ fetch: fetchMock as unknown as typeof fetch })
    const adapter = createNotionServerAdapter(deps)
    const detail = await adapter.fetchDetail({ sectionId: 'recent', itemId: 'p1' })

    expect(detail.title).toBe('Nota 1')
    expect(detail.meta).toEqual([
      { label: 'Last edited', value: '2026-07-01' },
      { label: 'Created', value: '2026-06-01' },
    ])
    expect(detail.blocks).toEqual([{ kind: 'text', text: 'contenido' }])
  })

  it('fetchDetail de una database no pisa el scope: bloque de texto "Database · open in Notion"', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      object: 'database', id: 'd1',
      created_time: '2026-05-01T00:00:00.000Z',
      last_edited_time: '2026-07-02T00:00:00.000Z',
      title: [{ plain_text: 'Roadmap' }],
      description: [{ plain_text: 'Plan de producto' }],
    }))
    const deps = makeDeps({ fetch: fetchMock as unknown as typeof fetch })
    const adapter = createNotionServerAdapter(deps)
    const detail = await adapter.fetchDetail({ sectionId: 'databases', itemId: 'd1' })

    expect(detail.title).toBe('Roadmap')
    expect(detail.blocks).toEqual([
      { kind: 'text', text: 'Database · open in Notion\n\nRoadmap\nPlan de producto' },
    ])
    // No debe llamar a /pages/ para una database
    expect(String(fetchMock.mock.calls[0][0])).toContain('/databases/d1')
  })

  it('compose arma children con paragraph + code cuando hay terminalOutput', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    const deps = makeDeps({ fetch: fetchMock as unknown as typeof fetch })
    const adapter = createNotionServerAdapter(deps)
    await adapter.compose({ sectionId: 'recent', itemId: 'p1' }, { text: 'hola', terminalOutput: '$ npm test' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.notion.com/v1/blocks/p1/children')
    expect((init as RequestInit).method).toBe('PATCH')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.children).toEqual([
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'hola' } }] } },
      { object: 'block', type: 'code', code: { rich_text: [{ type: 'text', text: { content: '$ npm test' } }], language: 'shell' } },
    ])
  })

  it('compose sin terminalOutput solo agrega el paragraph', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    const deps = makeDeps({ fetch: fetchMock as unknown as typeof fetch })
    const adapter = createNotionServerAdapter(deps)
    await adapter.compose({ sectionId: 'recent', itemId: 'p1' }, { text: 'hola' })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.children).toHaveLength(1)
  })

  it('sin token guardado, tira NotConnectedError', async () => {
    const deps = makeDeps({ getToken: () => null })
    const adapter = createNotionServerAdapter(deps)
    await expect(adapter.fetchSections({ repoPath: null, branch: null })).rejects.toBeInstanceOf(NotConnectedError)
  })

  it('401 de la API mapea a NotConnectedError', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: 'Unauthorized' }, { status: 401, ok: false }))
    const deps = makeDeps({ fetch: fetchMock as unknown as typeof fetch })
    const adapter = createNotionServerAdapter(deps)
    await expect(adapter.fetchSections({ repoPath: null, branch: null })).rejects.toBeInstanceOf(NotConnectedError)
  })

  it('otro error HTTP (p.ej. 500) tira un Error genérico (API_ERROR en el host)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, { status: 500, ok: false }))
    const deps = makeDeps({ fetch: fetchMock as unknown as typeof fetch })
    const adapter = createNotionServerAdapter(deps)
    await expect(adapter.fetchSections({ repoPath: null, branch: null })).rejects.toThrow()
  })

  it('resolveWorktreeEntity siempre devuelve null (no hay mapeo natural)', async () => {
    const adapter = createNotionServerAdapter(makeDeps())
    await expect(adapter.resolveWorktreeEntity({ repoPath: '/x', branch: 'main' })).resolves.toBeNull()
  })

  it('actions expone un único refresh secundario', () => {
    const adapter = createNotionServerAdapter(makeDeps())
    expect(adapter.actions({ ref: { sectionId: 'recent', itemId: 'p1' }, title: 't', meta: [], blocks: [] }))
      .toEqual([{ id: 'refresh', label: '↻ Refresh', kind: 'secondary' }])
  })
})
