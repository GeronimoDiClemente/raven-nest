// Punto único de registro de los adapters reales de paneles (plan Hito 2+
// Fase 2). Cada worker de servicio (Slack/GitHub/Jira/Notion) agrega su
// `registerPanelAdapter(...)` acá — el merge de las tasks en paralelo toca
// este único archivo en vez de pisarse en main.ts.
import { registerPanelAdapter } from '../integration-panels'
import { createGitHubServerAdapter } from './github'

export function registerAllPanelAdapters(): void {
  registerPanelAdapter('github', createGitHubServerAdapter)
}
