// Adapter server-side de Notion (plan Hito 2+, Task N). Pega contra
// https://api.notion.com/v1/* con Bearer token + header `Notion-Version`.
// El token nunca sale del main process: viaja por IPC solo el resultado
// plano armado acá (ver electron/integration-panels.ts).
import {
  NotConnectedError,
  type ComposeBody,
  type DetailBlock,
  type DetailModel,
  type ItemRef,
  type PanelAction,
  type PanelAdapterDeps,
  type Section,
  type ServerPanelAdapter,
  type WorktreeContext,
} from '../integration-panels'

const NOTION_API_BASE = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

interface NotionRichText {
  plain_text?: string
}

interface NotionTitleProperty {
  type: string
  title?: NotionRichText[]
}

interface NotionPage {
  object: 'page'
  id: string
  created_time?: string
  last_edited_time?: string
  properties?: Record<string, NotionTitleProperty>
}

interface NotionDatabase {
  object: 'database'
  id: string
  created_time?: string
  last_edited_time?: string
  title?: NotionRichText[]
  description?: NotionRichText[]
}

type NotionSearchResult = NotionPage | NotionDatabase

interface NotionBlock {
  type: string
  [key: string]: unknown
}

// La credencial guardada por el form de Connect (auth.kind: 'apiKey') es
// JSON.stringify({ token: '...' }) (ver IntegrationsMarketplace.tsx), pero
// toleramos también un string crudo (por si se guardó a mano o desde otro
// flujo) para no dejar el panel roto por un detalle de formato.
export function parseNotionToken(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed
    if (parsed && typeof parsed === 'object' && typeof (parsed as { token?: unknown }).token === 'string') {
      return (parsed as { token: string }).token
    }
  } catch {
    // no era JSON válido: tratamos el string crudo como el token
  }
  return raw
}

function richTextToPlain(richText: NotionRichText[] | undefined): string {
  if (!richText) return ''
  return richText.map((t) => t.plain_text ?? '').join('')
}

// Título de un resultado de /search: para páginas está en la property de
// tipo 'title' (nombre de la property varía, por eso buscamos por type);
// para databases es un array top-level.
export function pageTitle(obj: NotionSearchResult): string {
  if (obj.object === 'database') {
    return richTextToPlain(obj.title) || 'Untitled database'
  }
  const properties = obj.properties ?? {}
  const titleProp = Object.values(properties).find((p) => p?.type === 'title')
  return richTextToPlain(titleProp?.title) || 'Untitled'
}

function formatNotionDate(iso: string | undefined): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

const HEADING_PREFIX: Record<string, string> = {
  heading_1: '# ',
  heading_2: '## ',
  heading_3: '### ',
}

// Mapea los blocks crudos de /blocks/{id}/children a DetailBlock del shell.
// Tipos no soportados (image, divider, table, etc.) se saltean a propósito —
// fuera de alcance de la Task N.
export function notionBlocksToDetail(blocks: NotionBlock[]): DetailBlock[] {
  const out: DetailBlock[] = []
  let numberedIndex = 0
  for (const block of blocks) {
    const type = block.type
    const payload = block[type] as { rich_text?: NotionRichText[]; language?: string } | undefined
    if (type === 'paragraph') {
      out.push({ kind: 'text', text: richTextToPlain(payload?.rich_text) })
    } else if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
      out.push({ kind: 'text', text: HEADING_PREFIX[type] + richTextToPlain(payload?.rich_text) })
    } else if (type === 'bulleted_list_item') {
      out.push({ kind: 'text', text: `• ${richTextToPlain(payload?.rich_text)}` })
    } else if (type === 'numbered_list_item') {
      numberedIndex += 1
      out.push({ kind: 'text', text: `${numberedIndex}. ${richTextToPlain(payload?.rich_text)}` })
    } else if (type === 'code') {
      out.push({ kind: 'code', code: richTextToPlain(payload?.rich_text), tag: payload?.language })
    }
  }
  return out
}

// Serializa los DetailBlock del shell a markdown para inyectar como spec inicial
// del agente (H5 Motor 2). text→línea tal cual (los headings ya vienen con `#`
// desde notionBlocksToDetail), code→bloque cercado, comment→cita. Bloques
// separados por línea en blanco. Puro y testeable (dado blocks[] → markdown).
export function blocksToMarkdown(blocks: DetailBlock[]): string {
  return blocks.map((b) => {
    if (b.kind === 'code') return '```' + (b.tag ?? '') + '\n' + b.code + '\n```'
    if (b.kind === 'comment') return `> ${b.author}: ${b.text}`
    return b.text
  }).join('\n\n')
}

// Baja una página de Notion completa como markdown: título (H1) + su contenido
// serializado. Reusa notionFetch + notionBlocksToDetail (mismo pipeline que el
// panel), así que hereda su cobertura de tipos de block.
export async function fetchPageMarkdown(deps: PanelAdapterDeps, pageId: string): Promise<string> {
  const [page, blocksRes] = await Promise.all([
    notionFetch<NotionPage>(deps, `/pages/${pageId}`),
    notionFetch<{ results: NotionBlock[] }>(deps, `/blocks/${pageId}/children?page_size=100`),
  ])
  return `# ${pageTitle(page)}\n\n${blocksToMarkdown(notionBlocksToDetail(blocksRes.results ?? []))}`
}

async function notionFetch<T>(deps: PanelAdapterDeps, path: string, init: { method?: string; body?: string } = {}): Promise<T> {
  const raw = deps.getToken('notion')
  if (!raw) throw new NotConnectedError()
  const token = parseNotionToken(raw)
  const res = await deps.fetch(`${NOTION_API_BASE}${path}`, {
    method: init.method ?? 'GET',
    body: init.body,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  })
  if (res.status === 401) throw new NotConnectedError()
  if (!res.ok) throw new Error(`Notion API error (${res.status})`)
  return (await res.json()) as T
}

async function fetchSections(deps: PanelAdapterDeps, _ctx: WorktreeContext): Promise<Section[]> {
  const json = await notionFetch<{ results: NotionSearchResult[] }>(deps, '/search', {
    method: 'POST',
    body: JSON.stringify({
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: 20,
    }),
  })
  const results = json.results ?? []
  const pages = results.filter((r): r is NotionPage => r.object === 'page')
  const databases = results.filter((r): r is NotionDatabase => r.object === 'database')
  return [
    {
      id: 'recent',
      label: 'Recent pages',
      items: pages.map((p) => ({ id: p.id, title: pageTitle(p), subtitle: formatNotionDate(p.last_edited_time) })),
    },
    {
      id: 'databases',
      label: 'Databases',
      items: databases.map((d) => ({ id: d.id, title: pageTitle(d), subtitle: formatNotionDate(d.last_edited_time) })),
    },
  ]
}

async function fetchDatabaseDetail(deps: PanelAdapterDeps, ref: ItemRef): Promise<DetailModel> {
  const db = await notionFetch<NotionDatabase>(deps, `/databases/${ref.itemId}`)
  const title = pageTitle(db)
  const description = richTextToPlain(db.description)
  return {
    ref,
    title,
    meta: [
      { label: 'Last edited', value: formatNotionDate(db.last_edited_time) },
      { label: 'Created', value: formatNotionDate(db.created_time) },
    ],
    // Fuera de alcance (Task N): renderizar filas de la database. Se abre
    // como bloque de texto con link a Notion.
    blocks: [
      { kind: 'text', text: `Database · open in Notion\n\n${title}${description ? `\n${description}` : ''}` },
    ],
  }
}

async function fetchPageDetail(deps: PanelAdapterDeps, ref: ItemRef): Promise<DetailModel> {
  const page = await notionFetch<NotionPage>(deps, `/pages/${ref.itemId}`)
  const blocksRes = await notionFetch<{ results: NotionBlock[] }>(deps, `/blocks/${ref.itemId}/children?page_size=50`)
  return {
    ref,
    title: pageTitle(page),
    meta: [
      { label: 'Last edited', value: formatNotionDate(page.last_edited_time) },
      { label: 'Created', value: formatNotionDate(page.created_time) },
    ],
    blocks: notionBlocksToDetail(blocksRes.results ?? []),
  }
}

async function fetchDetail(deps: PanelAdapterDeps, ref: ItemRef): Promise<DetailModel> {
  return ref.sectionId === 'databases' ? fetchDatabaseDetail(deps, ref) : fetchPageDetail(deps, ref)
}

async function compose(deps: PanelAdapterDeps, target: ItemRef, body: ComposeBody): Promise<void> {
  const children: Record<string, unknown>[] = [
    { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: body.text } }] } },
  ]
  if (body.terminalOutput) {
    children.push({
      object: 'block',
      type: 'code',
      code: { rich_text: [{ type: 'text', text: { content: body.terminalOutput } }], language: 'shell' },
    })
  }
  await notionFetch(deps, `/blocks/${target.itemId}/children`, {
    method: 'PATCH',
    body: JSON.stringify({ children }),
  })
}

export function createNotionServerAdapter(deps: PanelAdapterDeps): ServerPanelAdapter {
  return {
    fetchSections: (ctx) => fetchSections(deps, ctx),
    fetchDetail: (ref) => fetchDetail(deps, ref),
    // No hay mapeo natural worktree → página de Notion (plan Hito 2+ Task N).
    resolveWorktreeEntity: async () => null,
    actions: (): PanelAction[] => [{ id: 'refresh', label: '↻ Refresh', kind: 'secondary' }],
    // Sin cache propia en el adapter: cada fetchDetail ya pega a la API,
    // así que 'refresh' no necesita bustear nada.
    runAction: async () => {},
    compose: (target, body) => compose(deps, target, body),
  }
}
