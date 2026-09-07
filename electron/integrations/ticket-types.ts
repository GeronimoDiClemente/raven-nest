// Contrato del Motor 1 (ticket loop). Providers viven en main: reciben deps
// inyectadas (token/config/fetch) igual que ServerPanelAdapter (hito 2).
import type { PanelAdapterDeps } from '../integration-panels'

export type TicketState = 'todo' | 'in_progress' | 'in_review' | 'done'

export interface Ticket {
  /** id visible tipo "PROJ-142" (Jira), "ENG-42" (Linear), "#123" (GitHub) */
  key: string
  /** id interno que el provider necesita para la API (issueId, node id, number) */
  providerId: string
  title: string
  url: string
  state: TicketState
  /** markdown: descripción + comentarios, para TASK.md */
  context: string
}

export interface TicketProvider {
  /** tickets asignados al usuario conectado, abiertos primero */
  listMyTickets(): Promise<Ticket[]>
  /** transiciona el ticket; no-op si la plataforma no tiene ese estado */
  transition(providerId: string, to: TicketState): Promise<void>
}

export type TicketProviderFactory = (deps: PanelAdapterDeps) => TicketProvider

const TICKET_STATES: readonly TicketState[] = ['todo', 'in_progress', 'in_review', 'done']

/**
 * Runtime guard for tickets crossing the IPC boundary: the renderer sends
 * `unknown`, and main interpolates key/title/url/context straight into
 * TASK.md — a blind cast would let a compromised renderer inject anything
 * (or crash the handler with null).
 */
export function isTicket(x: unknown): x is Ticket {
  if (!x || typeof x !== 'object') return false
  const t = x as Record<string, unknown>
  return typeof t.key === 'string'
    && typeof t.providerId === 'string'
    && typeof t.title === 'string'
    && typeof t.url === 'string'
    && typeof t.context === 'string'
    && TICKET_STATES.includes(t.state as TicketState)
}
