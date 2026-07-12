import { describe, it, expect, vi } from 'vitest'
import { createJiraTicketProvider } from '../integrations/tickets-jira'
import { createLinearTicketProvider } from '../integrations/tickets-linear'
import type { PanelAdapterDeps } from '../integration-panels'

// Jira creds are the same JSON blob the milestone-2 adapter stores in
// pluginCreds under 'jira' ({email, apiToken, siteUrl}); other providers
// (Linear/GitHub) keep a plain token string.
function deps(responses: Record<string, unknown>): PanelAdapterDeps {
  return {
    getToken: (pluginId: string) =>
      pluginId === 'jira'
        ? JSON.stringify({ email: 'g@a.com', apiToken: 'tok', siteUrl: 'https://acme.atlassian.net' })
        : 'tok',
    getConfig: () => ({}),
    fetch: vi.fn(async (url: RequestInfo | URL) => {
      const key = Object.keys(responses).find(k => String(url).includes(k))
      if (!key) return new Response('{}', { status: 404 })
      return new Response(JSON.stringify(responses[key]), { status: 200 })
    }) as unknown as typeof fetch,
  }
}

describe('JiraTicketProvider', () => {
  it('lista tickets asignados con estado mapeado', async () => {
    const p = createJiraTicketProvider(deps({
      '/rest/api/3/search': {
        issues: [{
          id: '10001', key: 'PROJ-142',
          fields: {
            summary: 'Fix auth', description: null,
            status: { statusCategory: { key: 'indeterminate' } },
            comment: { comments: [] },
          },
        }],
      },
    }))
    const t = await p.listMyTickets()
    expect(t[0]).toMatchObject({
      key: 'PROJ-142', providerId: '10001', title: 'Fix auth', state: 'in_progress',
      url: 'https://acme.atlassian.net/browse/PROJ-142',
    })
  })

  it('transition busca la transición por categoría y la ejecuta', async () => {
    const d = deps({
      '/transitions': { transitions: [
        { id: '31', to: { statusCategory: { key: 'indeterminate' } } },
        { id: '41', to: { statusCategory: { key: 'done' } } },
      ] },
    })
    const p = createJiraTicketProvider(d)
    await p.transition('10001', 'done')
    const calls = (d.fetch as ReturnType<typeof vi.fn>).mock.calls
    const post = calls.find(c => c[1]?.method === 'POST')
    expect(post?.[0]).toContain('/rest/api/3/issue/10001/transitions')
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({ transition: { id: '41' } })
  })
})

describe('LinearTicketProvider', () => {
  it('lista assigned issues del viewer', async () => {
    const d = deps({
      'api.linear.app': { data: { viewer: { assignedIssues: { nodes: [{
        id: 'uuid-1', identifier: 'ENG-42', title: 'Ship it',
        url: 'https://linear.app/acme/issue/ENG-42',
        state: { type: 'started' },
        description: 'the spec',
        comments: { nodes: [{ user: { name: 'Bau' }, body: 'dale' }] },
      }] } } } },
    })
    const p = createLinearTicketProvider(d)
    const t = await p.listMyTickets()
    expect(t[0]).toMatchObject({ key: 'ENG-42', providerId: 'uuid-1', state: 'in_progress' })
    expect(t[0].context).toContain('the spec')
    expect(t[0].context).toContain('Bau')
  })

  it('transition muta el estado buscando el workflow state del team', async () => {
    const d = deps({
      'api.linear.app': { data: {
        issue: { team: { states: { nodes: [
          { id: 's-review', type: 'started', name: 'In Review' },
          { id: 's-done', type: 'completed', name: 'Done' },
        ] } } },
        issueUpdate: { success: true },
      } },
    })
    const p = createLinearTicketProvider(d)
    await p.transition('uuid-1', 'done')
    const calls = (d.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2) // query states + mutation
    expect(String(calls.at(-1)?.[1]?.body)).toContain('s-done')
  })
})
