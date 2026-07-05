// Adapter de datos fake para el hito 1: valida el shell sin OAuth ni APIs.
// El estado vive en memoria del closure (se resetea al recargar).
import type {
  IntegrationAdapter, Section, DetailModel, ItemRef, WorktreeContext, ComposeBody,
} from './types'

export function createMockAdapter(): IntegrationAdapter {
  const comments: Record<string, { author: string; when: string; text: string }[]> = {}

  const sections: Section[] = [
    {
      id: 'mine', label: 'Mi trabajo',
      items: [
        { id: 'demo-231', title: 'Marketplace de integraciones — OAuth Slack', subtitle: 'In Progress · vos', accent: 'DEMO-231' },
        { id: 'demo-228', title: 'Gate Pro server-side vía Supabase', subtitle: 'To Do · vos', accent: 'DEMO-228' },
      ],
    },
    {
      id: 'recent', label: 'Recientes',
      items: [
        { id: 'demo-209', title: 'Catálogo remoto plugin_catalog', subtitle: 'Code Review', accent: 'DEMO-209' },
      ],
    },
  ]

  const details: Record<string, Omit<DetailModel, 'blocks'> & { description: string }> = {
    'demo-231': {
      ref: { sectionId: 'mine', itemId: 'demo-231' },
      title: 'Marketplace de integraciones — OAuth Slack',
      key: 'DEMO-231', status: 'In Progress',
      meta: [{ label: 'Asignada a', value: 'Gerónimo' }, { label: 'Prioridad', value: 'Alta' }],
      description: 'Item de demo vinculado al branch actual. Probá las acciones y el compose.',
    },
    'demo-228': {
      ref: { sectionId: 'mine', itemId: 'demo-228' },
      title: 'Gate Pro server-side vía Supabase',
      key: 'DEMO-228', status: 'To Do',
      meta: [{ label: 'Asignada a', value: 'Gerónimo' }],
      description: 'Validación del tier contra la DB en cada arranque de sesión de panel.',
    },
    'demo-209': {
      ref: { sectionId: 'recent', itemId: 'demo-209' },
      title: 'Catálogo remoto plugin_catalog',
      key: 'DEMO-209', status: 'Code Review',
      meta: [{ label: 'Asignada a', value: 'Matías' }],
      description: 'Fallback local BUILTIN_CATALOG cuando no hay red.',
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
      ;(comments[target.itemId] ??= []).push({ author: 'Vos', when: 'ahora', text })
    },
  }
}
