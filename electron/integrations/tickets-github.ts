import type { PanelAdapterDeps } from '../integration-panels'
import type { Ticket, TicketProvider } from './ticket-types'

// GitHub Issues. Token: the app's OAuth token (pluginCreds 'github', same
// fallback the milestone-2 GitHub adapter uses). providerId = "owner/repo#number".
// GitHub has no intermediate states: open/closed only. in_progress/in_review are
// no-ops (branch and PR tell the real state — inference engine, Task F).
const API = 'https://api.github.com'

export function createGitHubTicketProvider(deps: PanelAdapterDeps): TicketProvider {
  const headers = () => ({
    Authorization: `Bearer ${deps.getToken('github')}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  })

  return {
    async listMyTickets(): Promise<Ticket[]> {
      const res = await deps.fetch(`${API}/issues?filter=assigned&state=open&per_page=50`, { headers: headers() })
      if (!res.ok) throw new Error(`GitHub ${res.status}`)
      const issues = await res.json() as Array<{
        number: number; title: string; state: string; html_url: string
        repository: { full_name: string }
        body: string | null
        pull_request?: unknown
      }>
      return issues
        .filter(i => !i.pull_request) // /issues also returns PRs: filter them out
        .map(i => ({
          key: `${i.repository.full_name}#${i.number}`,
          providerId: `${i.repository.full_name}#${i.number}`,
          title: i.title,
          url: i.html_url,
          state: 'todo' as const,
          context: i.body ?? '',
        }))
    },

    async transition(providerId, to): Promise<void> {
      if (to !== 'done') return
      const m = providerId.match(/^(.+)#(\d+)$/)
      if (!m) return
      await deps.fetch(`${API}/repos/${m[1]}/issues/${m[2]}`, {
        method: 'PATCH', headers: headers(), body: JSON.stringify({ state: 'closed' }),
      })
    },
  }
}
