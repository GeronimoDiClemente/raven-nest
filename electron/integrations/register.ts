// Punto único de wiring de los adapters reales de paneles (plan Hito 2+,
// Fase 2). Cada task de servicio agrega UN import + UNA línea acá — el
// merge de los worktrees en paralelo (Slack/GitHub/Jira/Notion) resuelve
// este archivo como único punto de contacto compartido.
import { registerPanelAdapter } from '../integration-panels'
import { createJiraServerAdapter } from './jira'

export function registerAllPanelAdapters(): void {
  registerPanelAdapter('jira', createJiraServerAdapter)
}
