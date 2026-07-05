// Adapter de datos fake para el hito 1: valida el shell sin OAuth ni APIs.
// El estado vive en memoria del closure (se resetea al recargar).
import type {
  IntegrationAdapter, Section, DetailModel, ItemRef, WorktreeContext, ComposeBody,
} from './types'

export function createMockAdapter(): IntegrationAdapter {
  const comments: Record<string, { author: string; when: string; text: string }[]> = {}

  const sections: Section[] = [
    {
      id: 'mine', label: 'My work',
      items: [
        { id: 'demo-231', title: 'Integrations marketplace — Slack OAuth', subtitle: 'In Progress · you', accent: 'DEMO-231' },
        { id: 'demo-228', title: 'Server-side Pro gate via Supabase', subtitle: 'To Do · you', accent: 'DEMO-228' },
      ],
    },
    {
      id: 'recent', label: 'Recent',
      items: [
        { id: 'demo-209', title: 'Remote plugin_catalog', subtitle: 'Code Review', accent: 'DEMO-209' },
      ],
    },
  ]

  const details: Record<string, Omit<DetailModel, 'blocks'> & { description: string }> = {
    'demo-231': {
      ref: { sectionId: 'mine', itemId: 'demo-231' },
      title: 'Integrations marketplace — Slack OAuth',
      key: 'DEMO-231', status: 'In Progress',
      meta: [{ label: 'Assignee', value: 'Gerónimo' }, { label: 'Priority', value: 'High' }],
      description: 'Demo item linked to the current branch. Try out the actions and the compose bar.',
    },
    'demo-228': {
      ref: { sectionId: 'mine', itemId: 'demo-228' },
      title: 'Server-side Pro gate via Supabase',
      key: 'DEMO-228', status: 'To Do',
      meta: [{ label: 'Assignee', value: 'Gerónimo' }],
      description: 'Validate the tier against the DB on every panel session startup.',
    },
    'demo-209': {
      ref: { sectionId: 'recent', itemId: 'demo-209' },
      title: 'Remote plugin_catalog',
      key: 'DEMO-209', status: 'Code Review',
      meta: [{ label: 'Assignee', value: 'Matías' }],
      description: 'Local BUILTIN_CATALOG fallback for when there is no network.',
    },
  }

  return {
    id: 'demo',
    displayName: 'Demo',
    fetchSections: async () => sections,
    fetchDetail: async (ref: ItemRef) => {
      const d = details[ref.itemId]
      return {
        ...d,
        blocks: [
          { kind: 'text', text: d.description },
          ...(comments[ref.itemId] ?? []).map((c) => ({ kind: 'comment' as const, ...c })),
        ],
      }
    },
    resolveWorktreeEntity: async (ctx: WorktreeContext) =>
      ctx.branch ? { sectionId: 'mine', itemId: 'demo-231' } : null,
    actions: (detail) =>
      detail.status === 'In Progress'
        ? [{ id: 'to-review', label: '→ Code Review', kind: 'secondary' }, { id: 'done', label: '→ Done', kind: 'primary' }]
        : [{ id: 'start', label: '→ In Progress', kind: 'primary' }],
    runAction: async (actionId, ref) => {
      const map: Record<string, string> = { 'to-review': 'Code Review', done: 'Done', start: 'In Progress' }
      details[ref.itemId].status = map[actionId] ?? details[ref.itemId].status
    },
    compose: async (target: ItemRef, body: ComposeBody) => {
      const text = body.terminalOutput ? `${body.text}\n\`\`\`\n${body.terminalOutput}\n\`\`\`` : body.text
      ;(comments[target.itemId] ??= []).push({ author: 'You', when: 'now', text })
    },
  }
}
