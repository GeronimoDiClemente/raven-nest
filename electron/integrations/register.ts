// Punto único de registro de los adapters reales de paneles (plan Hito 2+
// Fase 2). main.ts llama a registerAllPanelAdapters() una sola vez al boot;
// cada task de la Fase 2 (Slack/GitHub/Jira/Notion) suma su propia línea acá
// para no pisarse entre worktrees paralelos.
import { registerPanelAdapter } from '../integration-panels'
import { createSlackServerAdapter } from './slack'

export function registerAllPanelAdapters(): void {
  registerPanelAdapter('slack', createSlackServerAdapter)
}
