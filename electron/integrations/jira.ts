// Adapter real de Jira (plan Hito 2+, Task J). REST API v3 con Basic auth
// (email + API token) sobre el site del usuario. El token guardado en
// PluginCredentialStore para 'jira' es el JSON `{email, apiToken, siteUrl}`
// que persiste el form de Connect (auth.kind 'apiKey', ver builtinCatalog.ts).
import {
  NotConnectedError,
  type ServerPanelAdapter,
  type PanelAdapterDeps,
  type WorktreeContext,
  type ItemRef,
  type Section,
  type SectionItem,
  type DetailModel,
  type DetailBlock,
  type PanelAction,
  type ComposeBody,
} from '../integration-panels'

interface JiraCreds {
  email: string
  apiToken: string
  siteUrl: string
}

// Forma mínima de un nodo ADF (Atlassian Document Format) — lo que
// necesitamos para renderizar descripción/comentarios como DetailBlock[].
export interface AdfNode {
  type?: string
  text?: string
  content?: AdfNode[]
  attrs?: Record<string, unknown>
}

interface JiraTransition {
  id: string
  name: string
}

interface JiraUser {
  displayName?: string
}

interface JiraStatus {
  name?: string
}

interface JiraPriority {
  name?: string
}

interface JiraComment {
  author?: JiraUser
  created?: string
  body?: AdfNode
}

interface JiraIssueSummary {
  key: string
  fields: {
    summary?: string
    status?: JiraStatus
    priority?: JiraPriority
  }
}

interface JiraIssueDetail {
  key: string
  fields: {
    summary?: string
    description?: AdfNode
    status?: JiraStatus
    priority?: JiraPriority
    assignee?: JiraUser
    comment?: { comments?: JiraComment[] }
  }
}

// -- ADF → DetailBlock[] -----------------------------------------------

function adfTextOf(node: AdfNode): string {
  if (node.text) return node.text
  if (!node.content) return ''
  return node.content.map(adfTextOf).join('')
}

// Camina el árbol ADF: paragraph/heading → texto plano, codeBlock → bloque
// de código; el resto de los contenedores (bulletList, listItem, blockquote,
// doc, etc.) se recorren recursivamente para no perder texto anidado.
export function adfToBlocks(doc: AdfNode | null | undefined): DetailBlock[] {
  if (!doc || !doc.content) return []
  const blocks: DetailBlock[] = []
  const walk = (node: AdfNode): void => {
    switch (node.type) {
      case 'paragraph':
      case 'heading': {
        const text = adfTextOf(node)
        if (text) blocks.push({ kind: 'text', text })
        return
      }
      case 'codeBlock': {
        const code = adfTextOf(node)
        const lang = node.attrs?.language
        blocks.push({ kind: 'code', code, tag: typeof lang === 'string' ? lang : undefined })
        return
      }
      default:
        node.content?.forEach(walk)
    }
  }
  doc.content.forEach(walk)
  return blocks
}

function blocksToPlainText(blocks: DetailBlock[]): string {
  return blocks
    .map((b) => (b.kind === 'code' ? '```\n' + b.code + '\n```' : b.kind === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n\n')
}

function relativeTime(iso: string | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  const diffMonth = Math.round(diffDay / 30)
  if (diffMonth < 12) return `${diffMonth}mo ago`
  const diffYear = Math.round(diffMonth / 12)
  return `${diffYear}y ago`
}

// -- Credenciales --------------------------------------------------------

// El Connect form (auth.kind 'apiKey') guarda un JSON string con los 3
// fields del manifest. Cualquier problema (sin token, JSON roto, fields
// faltantes) es indistinguible de "no conectado" para el shell.
function parseCreds(raw: string | null): JiraCreds {
  if (!raw) throw new NotConnectedError()
  let parsed: Partial<JiraCreds>
  try {
    parsed = JSON.parse(raw) as Partial<JiraCreds>
  } catch {
    throw new NotConnectedError()
  }
  if (!parsed.email || !parsed.apiToken || !parsed.siteUrl) throw new NotConnectedError()
  return { email: parsed.email, apiToken: parsed.apiToken, siteUrl: parsed.siteUrl }
}

function siteUrlOf(creds: JiraCreds): string {
  return creds.siteUrl.replace(/\/+$/, '')
}

function authHeader(creds: JiraCreds): string {
  return `Basic ${Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64')}`
}

// Wrapper de fetch con Basic auth + base REST v3. 401/403 → NOT_CONNECTED
// (token inválido/revocado); otros status quedan para que el caller decida
// (p.ej. resolveWorktreeEntity trata 404 como "no existe", no como error).
async function jiraFetch(
  deps: PanelAdapterDeps,
  creds: JiraCreds,
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<Response> {
  const res = await deps.fetch(`${siteUrlOf(creds)}/rest/api/3${path}`, {
    method: init.method ?? 'GET',
    body: init.body,
    headers: {
      Authorization: authHeader(creds),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  })
  if (res.status === 401 || res.status === 403) throw new NotConnectedError()
  return res
}

function toSectionItem(issue: JiraIssueSummary): SectionItem {
  return {
    id: issue.key,
    title: issue.fields.summary ?? issue.key,
    subtitle: issue.fields.status?.name,
    accent: issue.key,
  }
}

async function searchIssues(
  deps: PanelAdapterDeps,
  creds: JiraCreds,
  jql: string,
  maxResults?: number,
): Promise<JiraIssueSummary[]> {
  const params = new URLSearchParams({ jql, fields: 'summary,status,priority,key' })
  if (maxResults != null) params.set('maxResults', String(maxResults))
  const res = await jiraFetch(deps, creds, `/search?${params.toString()}`)
  if (!res.ok) throw new Error(`Jira search failed (${res.status})`)
  const json = (await res.json()) as { issues?: JiraIssueSummary[] }
  return json.issues ?? []
}

const KEY_RE = /[A-Z][A-Z0-9]+-\d+/

export function createJiraServerAdapter(deps: PanelAdapterDeps): ServerPanelAdapter {
  // Las transitions se piden en fetchDetail (necesitan un roundtrip propio)
  // y se cachean acá por clave de issue para que `actions(detail)` — sync
  // en el contrato — pueda mapearlas a botones sin otro request.
  const transitionsByKey = new Map<string, JiraTransition[]>()

  return {
    async fetchSections(_ctx: WorktreeContext): Promise<Section[]> {
      const creds = parseCreds(deps.getToken('jira'))
      const [mine, recent] = await Promise.all([
        searchIssues(deps, creds, 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC'),
        searchIssues(deps, creds, 'ORDER BY updated DESC', 10),
      ])
      return [
        { id: 'mine', label: 'My work', items: mine.map(toSectionItem) },
        { id: 'recent', label: 'Recently updated', items: recent.map(toSectionItem) },
      ]
    },

    async fetchDetail(ref: ItemRef): Promise<DetailModel> {
      const creds = parseCreds(deps.getToken('jira'))
      const key = ref.itemId
      const res = await jiraFetch(deps, creds, `/issue/${encodeURIComponent(key)}?fields=summary,description,status,priority,assignee,comment`)
      if (!res.ok) throw new Error(`Jira issue fetch failed (${res.status})`)
      const issue = (await res.json()) as JiraIssueDetail

      const descriptionBlocks = adfToBlocks(issue.fields.description)
      const commentBlocks: DetailBlock[] = (issue.fields.comment?.comments ?? []).map((c) => ({
        kind: 'comment',
        author: c.author?.displayName ?? 'Unknown',
        when: relativeTime(c.created),
        text: blocksToPlainText(adfToBlocks(c.body)),
      }))

      const transitionsRes = await jiraFetch(deps, creds, `/issue/${encodeURIComponent(key)}/transitions`)
      transitionsByKey.set(
        key,
        transitionsRes.ok ? ((await transitionsRes.json()) as { transitions?: JiraTransition[] }).transitions ?? [] : [],
      )

      return {
        ref: { sectionId: ref.sectionId, itemId: key },
        title: issue.fields.summary ?? key,
        key,
        status: issue.fields.status?.name,
        meta: [
          { label: 'Assignee', value: issue.fields.assignee?.displayName ?? 'Unassigned' },
          { label: 'Priority', value: issue.fields.priority?.name ?? '—' },
        ],
        blocks: [...descriptionBlocks, ...commentBlocks],
      }
    },

    async resolveWorktreeEntity(ctx: WorktreeContext): Promise<ItemRef | null> {
      const match = ctx.branch?.match(KEY_RE)
      if (!match) return null
      const key = match[0]
      const creds = parseCreds(deps.getToken('jira'))
      const res = await jiraFetch(deps, creds, `/issue/${encodeURIComponent(key)}?fields=summary`)
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`Jira issue lookup failed (${res.status})`)
      return { sectionId: 'mine', itemId: key }
    },

    actions(detail: DetailModel): PanelAction[] {
      const key = detail.key
      if (!key) return []
      const transitions = transitionsByKey.get(key) ?? []
      return transitions.slice(0, 3).map((t, i) => ({
        id: t.id,
        label: `→ ${t.name}`,
        kind: i === 0 ? 'primary' : 'secondary',
      }))
    },

    async runAction(actionId: string, ref: ItemRef): Promise<void> {
      const creds = parseCreds(deps.getToken('jira'))
      const res = await jiraFetch(deps, creds, `/issue/${encodeURIComponent(ref.itemId)}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ transition: { id: actionId } }),
      })
      if (!res.ok) throw new Error(`Jira transition failed (${res.status})`)
    },

    async compose(target: ItemRef, body: ComposeBody): Promise<void> {
      const creds = parseCreds(deps.getToken('jira'))
      const content: AdfNode[] = [{ type: 'paragraph', content: [{ type: 'text', text: body.text }] }]
      if (body.terminalOutput) {
        content.push({ type: 'codeBlock', content: [{ type: 'text', text: body.terminalOutput }] })
      }
      const res = await jiraFetch(deps, creds, `/issue/${encodeURIComponent(target.itemId)}/comment`, {
        method: 'POST',
        body: JSON.stringify({ body: { type: 'doc', version: 1, content } }),
      })
      if (!res.ok) throw new Error(`Jira comment failed (${res.status})`)
    },
  }
}
