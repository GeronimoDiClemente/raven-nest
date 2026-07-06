// Punto único de wiring de los adapters main-side de paneles (plan Hito 2+,
// Fase 2). Cada adapter se agrega en UNA línea acá para que el merge de los
// worktrees en paralelo (slack/github/jira/notion) no pise otros archivos
// compartidos aparte de este.
import { registerPanelAdapter } from '../integration-panels'
import { createNotionServerAdapter } from './notion'
import { createSlackServerAdapter } from './slack'
import { createJiraServerAdapter } from './jira'

export function registerAllPanelAdapters(): void {
  registerPanelAdapter('notion', createNotionServerAdapter)
  registerPanelAdapter('slack', createSlackServerAdapter)
  registerPanelAdapter('jira', createJiraServerAdapter)
}
