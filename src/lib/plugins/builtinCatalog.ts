import type { PluginManifest } from '../../types'

export const BUILTIN_CATALOG: PluginManifest[] = [
  {
    id: 'slack', name: 'Slack',
    description: 'Get notified about your agents in Slack.',
    category: 'comms', icon: 'slack', color: '#4A154B',
    type: 'integration', publisher: 'raven', tier: 'free',
    auth: { kind: 'oauth' },
    configSchema: [
      { key: 'channel', label: 'Channel', type: 'text', required: true, placeholder: '#dev' },
    ],
    contributes: {
      menuItems: [
        { id: 'slack.notify', label: 'Notify Slack', actionId: 'notify', surface: 'repoActions' },
      ],
      events: [{ on: 'onAgentDone', actionId: 'notify' }],
    },
  },
  {
    id: 'github', name: 'GitHub',
    description: 'Track issues and PRs for the active worktree.',
    category: 'pm', icon: 'github', color: '#181717',
    type: 'integration', publisher: 'raven', tier: 'free',
    auth: { kind: 'oauth' },
  },
  {
    id: 'notion', name: 'Notion',
    description: 'Send the worktree summary to Notion.',
    category: 'docs', icon: 'notion', color: '#0F0F0F',
    type: 'integration', publisher: 'raven', tier: 'free',
    auth: {
      kind: 'apiKey',
      fields: [
        { key: 'token', label: 'Internal integration token', type: 'password', required: true, placeholder: 'secret_...' },
      ],
    },
  },
  {
    id: 'jira', name: 'Jira',
    description: 'Create worktrees from Jira issues.',
    category: 'pm', icon: 'jira', color: '#0052CC',
    type: 'integration', publisher: 'raven', tier: 'free',
    auth: {
      kind: 'apiKey',
      fields: [
        { key: 'email', label: 'Email', type: 'text', required: true, placeholder: 'you@company.com' },
        { key: 'apiToken', label: 'API token', type: 'password', required: true },
        { key: 'siteUrl', label: 'Site URL', type: 'text', required: true, placeholder: 'https://yourcompany.atlassian.net' },
      ],
    },
  },
  {
    id: 'figma', name: 'Figma', description: 'Coming soon.',
    category: 'design', icon: 'figma', color: '#F24E1E',
    type: 'integration', publisher: 'raven', tier: 'free', comingSoon: true,
  },
  {
    id: 'sentry', name: 'Sentry', description: 'Coming soon.',
    category: 'observability', icon: 'sentry', color: '#362D59',
    type: 'integration', publisher: 'raven', tier: 'free', comingSoon: true,
  },
  {
    id: 'demo', name: 'Demo',
    description: 'Demo panel for the integrations shell (fake data).',
    category: 'comms', icon: 'demo', color: '#0066FF',
    type: 'integration', publisher: 'raven', tier: 'free',
    auth: { kind: 'none' },
  },
]
