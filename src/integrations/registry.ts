// Mapea pluginId (catálogo) → adapter del panel. Hito 2+ suma slack/github/jira/notion.
import type { IntegrationAdapter } from './types'
import { createMockAdapter } from './mockAdapter'
import { createIpcAdapter } from './ipcAdapter'

const adapters: Record<string, () => IntegrationAdapter> = {
  demo: createMockAdapter,
  jira: () => createIpcAdapter('jira', 'Jira'),
}

export function getAdapter(pluginId: string): IntegrationAdapter | null {
  return adapters[pluginId]?.() ?? null
}

export function hasAdapter(pluginId: string): boolean {
  return pluginId in adapters
}
