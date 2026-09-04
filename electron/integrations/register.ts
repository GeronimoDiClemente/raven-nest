// Punto único de wiring de los adapters main-side de paneles (plan Hito 2+,
// Fase 2). Cada adapter se agrega en UNA línea acá para que el merge de los
// worktrees en paralelo (slack/github/jira/notion) no pise otros archivos
// compartidos aparte de este.
import { registerPanelAdapter } from '../integration-panels'
import { createNotionServerAdapter } from './notion'
import { createSlackServerAdapter } from './slack'
import { createJiraServerAdapter } from './jira'
import { createGitHubServerAdapter } from './github'
import { ticketLoop } from '../ticket-loop'
import { createJiraTicketProvider } from './tickets-jira'
import { createLinearTicketProvider } from './tickets-linear'
import { createGitHubTicketProvider } from './tickets-github'

export function registerAllPanelAdapters(): void {
  registerPanelAdapter('notion', createNotionServerAdapter)
  registerPanelAdapter('slack', createSlackServerAdapter)
  registerPanelAdapter('jira', createJiraServerAdapter)
  registerPanelAdapter('github', createGitHubServerAdapter)
}

// Motor 1 (H3 ticket loop): one line per platform, same single-wiring-point
// rationale as the panel adapters above.
export function registerAllTicketProviders(): void {
  ticketLoop.register('jira', createJiraTicketProvider)
  ticketLoop.register('linear', createLinearTicketProvider)
  ticketLoop.register('github', createGitHubTicketProvider)
}
