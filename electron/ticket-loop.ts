import type { PanelAdapterDeps } from './integration-panels'
import type { Ticket, TicketProviderFactory } from './integrations/ticket-types'

interface Tracked { pluginId: string; providerId: string; key: string }

// Motor 1: registry de providers + tracking branch→ticket para inferir estado.
// El tracking vive en memoria: si la app se reinicia, el polling de PRs (main.ts)
// re-detecta por nombre de rama de los worktrees vivos — el branch ES el vínculo
// persistente (patrón Linear), no necesitamos otra base de datos.
export class TicketLoop {
  private factories = new Map<string, TicketProviderFactory>()
  private tracked = new Map<string, Tracked>()

  register(pluginId: string, factory: TicketProviderFactory): void {
    this.factories.set(pluginId, factory)
  }

  registeredIds(): string[] { return [...this.factories.keys()] }

  private provider(pluginId: string, deps: PanelAdapterDeps) {
    const f = this.factories.get(pluginId)
    return f ? f(deps) : null
  }

  async list(pluginId: string, deps: PanelAdapterDeps): Promise<Ticket[]> {
    const p = this.provider(pluginId, deps)
    if (!p) return []
    try {
      return await p.listMyTickets()
    } catch (err) {
      console.warn('[ticket-loop] list failed', pluginId, err)
      return []
    }
  }

  async startWork(pluginId: string, ticket: Ticket, branch: string, deps: PanelAdapterDeps): Promise<void> {
    this.tracked.set(branch, { pluginId, providerId: ticket.providerId, key: ticket.key })
    const p = this.provider(pluginId, deps)
    if (!p) return
    try {
      await p.transition(ticket.providerId, 'in_progress')
    } catch (err) {
      // La transición es best-effort: el worktree ya se creó, no rompemos el flujo.
      console.warn('[ticket-loop] transition in_progress failed', ticket.key, err)
    }
  }

  trackedTicket(branch: string): Tracked | undefined { return this.tracked.get(branch) }

  async onPrStateChanged(branch: string, pr: 'open' | 'merged', deps: PanelAdapterDeps): Promise<void> {
    const t = this.tracked.get(branch)
    if (!t) return
    const p = this.provider(t.pluginId, deps)
    if (!p) return
    try {
      await p.transition(t.providerId, pr === 'open' ? 'in_review' : 'done')
      if (pr === 'merged') this.tracked.delete(branch)
    } catch (err) {
      console.warn('[ticket-loop] transition on PR', pr, t.key, err)
    }
  }
}

export const ticketLoop = new TicketLoop()
