import { NotConnectedError, type PanelAdapterDeps } from '../integration-panels'
import type { Ticket, TicketProvider, TicketState } from './ticket-types'

// Jira REST v3. Credentials are the same JSON blob the milestone-2 adapter
// (jira.ts) stores in pluginCreds under 'jira': {email, apiToken, siteUrl}.
const CATEGORY_TO_STATE: Record<string, TicketState> = {
  new: 'todo', indeterminate: 'in_progress', done: 'done',
}
const STATE_TO_CATEGORY: Record<TicketState, string> = {
  todo: 'new', in_progress: 'indeterminate', in_review: 'indeterminate', done: 'done',
}

interface JiraCreds {
  email: string
  apiToken: string
  siteUrl: string
}

// Same contract as jira.ts parseCreds: anything wrong with the stored blob
// (missing token, broken JSON, missing fields) reads as "not connected".
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

export function createJiraTicketProvider(deps: PanelAdapterDeps): TicketProvider {
  const creds = () => parseCreds(deps.getToken('jira'))
  const baseOf = (c: JiraCreds) => c.siteUrl.replace(/\/+$/, '')
  const headers = (c: JiraCreds) => ({
    Authorization: 'Basic ' + Buffer.from(`${c.email}:${c.apiToken}`).toString('base64'),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  })

  return {
    async listMyTickets(): Promise<Ticket[]> {
      const c = creds()
      const base = baseOf(c)
      const jql = encodeURIComponent('assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC')
      const res = await deps.fetch(`${base}/rest/api/3/search?jql=${jql}&maxResults=50&fields=summary,description,status,comment`, { headers: headers(c) })
      if (!res.ok) throw new Error(`Jira ${res.status}`)
      const data = await res.json() as { issues: Array<{ id: string; key: string; fields: {
        summary: string; description: unknown
        status: { statusCategory: { key: string } }
        comment?: { comments: Array<{ author?: { displayName?: string }; body?: unknown }> }
      } }> }
      return data.issues.map(i => ({
        key: i.key,
        providerId: i.id,
        title: i.fields.summary,
        url: `${base}/browse/${i.key}`,
        state: CATEGORY_TO_STATE[i.fields.status.statusCategory.key] ?? 'todo',
        context: adfToText(i.fields.description) + commentsToText(i.fields.comment?.comments ?? []),
      }))
    },

    async transition(providerId, to): Promise<void> {
      const c = creds()
      const base = baseOf(c)
      const res = await deps.fetch(`${base}/rest/api/3/issue/${providerId}/transitions`, { headers: headers(c) })
      if (!res.ok) return
      const { transitions } = await res.json() as { transitions: Array<{ id: string; to: { statusCategory: { key: string } } }> }
      const target = transitions.find(t => t.to.statusCategory.key === STATE_TO_CATEGORY[to])
      if (!target) return // the project's workflow lacks that transition: no-op
      await deps.fetch(`${base}/rest/api/3/issue/${providerId}/transitions`, {
        method: 'POST', headers: headers(c), body: JSON.stringify({ transition: { id: target.id } }),
      })
    },
  }
}

// Jira v3 returns description/comments as ADF (a tree). We extract plain
// text only: enough for TASK.md, no new dependency (YAGNI a full renderer).
function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { text?: string; content?: unknown[] }
  const own = typeof n.text === 'string' ? n.text : ''
  const kids = Array.isArray(n.content) ? n.content.map(adfToText).join('') : ''
  return own + kids + ('content' in n ? '\n' : '')
}

function commentsToText(comments: Array<{ author?: { displayName?: string }; body?: unknown }>): string {
  if (comments.length === 0) return ''
  return '\n## Comments\n' + comments.map(c => `- **${c.author?.displayName ?? '?'}**: ${adfToText(c.body).trim()}`).join('\n')
}
