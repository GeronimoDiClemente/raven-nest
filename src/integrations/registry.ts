// Mapea pluginId (catálogo) → adapter del panel. Hito 2+ suma slack/github/jira/notion.
import type { IntegrationAdapter } from './types'
import { createMockAdapter } from './mockAdapter'
import { createIpcAdapter } from './ipcAdapter'

// gcal (H6) NO usa el panel genérico (sections/detail): un panel dedicado
// (<CalendarPanel>) lo renderiza. Igual se registra acá para que `hasAdapter('gcal')`
// sea true y aparezca en el nav "Installed"; el adapter genérico nunca se invoca para gcal.
const adapters: Record<string, () => IntegrationAdapter> = {
  demo: createMockAdapter,
  notion: () => createIpcAdapter('notion', 'Notion'),
  slack: () => createIpcAdapter('slack', 'Slack'),
  jira: () => createIpcAdapter('jira', 'Jira'),
  github: () => createIpcAdapter('github', 'GitHub'),
  gcal: () => createIpcAdapter('gcal', 'Google Calendar'),
}

export function getAdapter(pluginId: string): IntegrationAdapter | null {
  return adapters[pluginId]?.() ?? null
}

export function hasAdapter(pluginId: string): boolean {
  return pluginId in adapters
}
