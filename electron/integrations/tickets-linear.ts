import { NotConnectedError, type PanelAdapterDeps } from '../integration-panels'
import type { Ticket, TicketProvider, TicketState } from './ticket-types'

// Linear GraphQL. Token = personal API key stored in pluginCreds under 'linear'
// as a plain string (unlike Jira's JSON blob).
const TYPE_TO_STATE: Record<string, TicketState> = {
  triage: 'todo', backlog: 'todo', unstarted: 'todo',
  started: 'in_progress', completed: 'done', canceled: 'done',
}
// in_review: Linear models it as a "started" state with a name; when
// transitioning we prefer a name match and fall back to the type if absent.
const STATE_TO_MATCH: Record<TicketState, { type: string; nameHint?: string }> = {
  todo: { type: 'unstarted' },
  in_progress: { type: 'started' },
  in_review: { type: 'started', nameHint: 'review' },
  done: { type: 'completed' },
}

const API = 'https://api.linear.app/graphql'

export function createLinearTicketProvider(deps: PanelAdapterDeps): TicketProvider {
  const gql = async (query: string, variables?: Record<string, unknown>) => {
    const token = deps.getToken('linear')
    if (!token) throw new NotConnectedError()
    const res = await deps.fetch(API, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })
    if (!res.ok) throw new Error(`Linear ${res.status}`)
    return (await res.json() as { data: Record<string, unknown> }).data
  }

  return {
    async listMyTickets(): Promise<Ticket[]> {
      const data = await gql(`query { viewer { assignedIssues(
        filter: { state: { type: { nin: ["completed","canceled"] } } }, first: 50
      ) { nodes {
        id identifier title url description
        state { type }
        comments(first: 20) { nodes { user { name } body } }
      } } } }`) as {
        viewer: { assignedIssues: { nodes: Array<{
          id: string; identifier: string; title: string; url: string
          description: string | null
          state: { type: string }
          comments: { nodes: Array<{ user: { name: string } | null; body: string }> }
        }> } }
      }
      return data.viewer.assignedIssues.nodes.map(n => ({
        key: n.identifier,
        providerId: n.id,
        title: n.title,
        url: n.url,
        state: TYPE_TO_STATE[n.state.type] ?? 'todo',
        context: (n.description ?? '') + (n.comments.nodes.length
          ? '\n## Comments\n' + n.comments.nodes.map(c => `- **${c.user?.name ?? '?'}**: ${c.body}`).join('\n')
          : ''),
      }))
    },

    async transition(providerId, to): Promise<void> {
      const match = STATE_TO_MATCH[to]
      const data = await gql(
        `query($id: String!) { issue(id: $id) { team { states { nodes { id type name } } } } }`,
        { id: providerId },
      ) as { issue: { team: { states: { nodes: Array<{ id: string; type: string; name: string }> } } } }
      const states = data.issue.team.states.nodes.filter(s => s.type === match.type)
      const target = (match.nameHint
        ? states.find(s => s.name.toLowerCase().includes(match.nameHint!))
        : undefined) ?? states[0]
      if (!target) return
      await gql(
        `mutation($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success } }`,
        { id: providerId, state: target.id },
      )
    },
  }
}
