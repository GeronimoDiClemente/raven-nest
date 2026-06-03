import type { PluginManifest } from '../../types'

export const BUILTIN_CATALOG: PluginManifest[] = [
  {
    id: 'slack', name: 'Slack',
    description: 'Recibí avisos de tus agentes en Slack.',
    category: 'comms', icon: 'slack', color: '#4A154B',
    type: 'integration', publisher: 'raven', tier: 'free',
    auth: { kind: 'oauth' },
    configSchema: [
      { key: 'channel', label: 'Canal', type: 'text', required: true, placeholder: '#dev' },
    ],
    contributes: {
      menuItems: [
        { id: 'slack.notify', label: 'Notificar a Slack', actionId: 'notify', surface: 'repoActions' },
      ],
      events: [{ on: 'onAgentDone', actionId: 'notify' }],
    },
  },
  {
    id: 'notion', name: 'Notion',
    description: 'Enviá el resumen del worktree a Notion.',
    category: 'docs', icon: 'notion', color: '#0F0F0F',
    type: 'integration', publisher: 'raven', tier: 'free', auth: { kind: 'oauth' },
  },
  {
    id: 'jira', name: 'Jira',
    description: 'Creá worktrees desde issues de Jira.',
    category: 'pm', icon: 'jira', color: '#0052CC',
    type: 'integration', publisher: 'raven', tier: 'free', auth: { kind: 'oauth' },
  },
  {
    id: 'figma', name: 'Figma', description: 'Próximamente.',
    category: 'design', icon: 'figma', color: '#F24E1E',
    type: 'integration', publisher: 'raven', tier: 'free', comingSoon: true,
  },
  {
    id: 'sentry', name: 'Sentry', description: 'Próximamente.',
    category: 'observability', icon: 'sentry', color: '#362D59',
    type: 'integration', publisher: 'raven', tier: 'free', comingSoon: true,
  },
]
