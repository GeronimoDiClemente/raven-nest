import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { PanelAdapterDeps } from './integration-panels'
import type { Ticket, TicketProviderFactory } from './integrations/ticket-types'

interface Tracked {
  pluginId: string
  providerId: string
  key: string
  /** "owner/repo" of the worktree's GitHub remote; null = no PR polling (v1 only infers on GitHub) */
  repoFullName: string | null
  /** last PR state already notified to the provider; 'merged' deletes the entry instead */
  lastPr?: 'open'
}

// Motor 1: provider registry + branch→ticket tracking to infer ticket state.
// The tracking map is persisted to disk (attachStorage) so the spec's
// "PR merged → Done" survives an app restart — the normal flow is create the
// worktree today, open the PR tomorrow. The branch name is the durable link
// (Linear pattern); the JSON file just remembers which ticket it points to.
export class TicketLoop {
  private factories = new Map<string, TicketProviderFactory>()
  private tracked = new Map<string, Tracked>()
  private storePath: string | null = null

  register(pluginId: string, factory: TicketProviderFactory): void {
    this.factories.set(pluginId, factory)
  }

  registeredIds(): string[] { return [...this.factories.keys()] }

  /**
   * Point the loop at its persistence file and load whatever tracking a
   * previous session left there. Entries with a broken shape are dropped.
   */
  attachStorage(filePath: string): void {
    this.storePath = filePath
    let raw: string
    try {
      raw = readFileSync(filePath, 'utf8')
    } catch {
      return // first run: nothing persisted yet
    }
    try {
      const data = JSON.parse(raw) as { tracked?: Record<string, unknown> }
      for (const [branch, v] of Object.entries(data.tracked ?? {})) {
        if (!v || typeof v !== 'object') continue
        const t = v as Partial<Tracked>
        if (typeof t.pluginId !== 'string' || typeof t.providerId !== 'string' || typeof t.key !== 'string') continue
        this.tracked.set(branch, {
          pluginId: t.pluginId,
          providerId: t.providerId,
          key: t.key,
          repoFullName: typeof t.repoFullName === 'string' ? t.repoFullName : null,
          ...(t.lastPr === 'open' ? { lastPr: 'open' as const } : {}),
        })
      }
    } catch (err) {
      console.warn('[ticket-loop] tracking store unreadable, starting empty', err)
    }
  }

  private saveTracked(): void {
    if (!this.storePath) return
    try {
      mkdirSync(dirname(this.storePath), { recursive: true })
      writeFileSync(this.storePath, JSON.stringify({ version: 1, tracked: Object.fromEntries(this.tracked) }, null, 2))
    } catch (err) {
      console.warn('[ticket-loop] tracking store write failed', err)
    }
  }

  /**
   * Boot reconciliation: drop tracked branches whose worktree no longer
   * exists (the worktree is the unit of work — no worktree, nothing to infer).
   */
  retainBranches(liveBranches: Iterable<string>): void {
    const live = new Set(liveBranches)
    let mutated = false
    for (const branch of [...this.tracked.keys()]) {
      if (!live.has(branch)) {
        this.tracked.delete(branch)
        mutated = true
      }
    }
    if (mutated) this.saveTracked()
  }

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

  async startWork(
    pluginId: string,
    ticket: Ticket,
    branch: string,
    deps: PanelAdapterDeps,
    repoFullName: string | null = null,
  ): Promise<void> {
    this.tracked.set(branch, { pluginId, providerId: ticket.providerId, key: ticket.key, repoFullName })
    this.saveTracked()
    const p = this.provider(pluginId, deps)
    if (!p) return
    try {
      await p.transition(ticket.providerId, 'in_progress')
    } catch (err) {
      // The transition is best-effort: the worktree already exists, don't break the flow.
      console.warn('[ticket-loop] transition in_progress failed', ticket.key, err)
    }
  }

  trackedTicket(branch: string): Tracked | undefined { return this.tracked.get(branch) }

  /** Distinct GitHub repos with at least one tracked branch — drives the poll. */
  trackedRepos(): string[] {
    const repos = new Set<string>()
    for (const t of this.tracked.values()) {
      if (t.repoFullName) repos.add(t.repoFullName)
    }
    return [...repos]
  }

  /**
   * Ask GitHub about PRs for each branch tracked AGAINST repoFullName (a
   * branch started in another repo is someone else's PR: skipping it avoids
   * both wasted requests and transitions fired by a same-named foreign
   * branch). Called from main.ts every 90s only for repos in trackedRepos().
   */
  async pollOnce(repoFullName: string, deps: PanelAdapterDeps): Promise<void> {
    for (const [branch, t] of this.tracked) {
      if (t.repoFullName !== repoFullName) continue
      try {
        const res = await deps.fetch(
          `https://api.github.com/repos/${repoFullName}/pulls?head=${encodeURIComponent(repoFullName.split('/')[0] + ':' + branch)}&state=all&per_page=1`,
          { headers: { Authorization: `Bearer ${deps.getToken('github')}`, Accept: 'application/vnd.github.v3+json' } },
        )
        if (!res.ok) continue
        const prs = await res.json() as Array<{ state: string; merged_at: string | null }>
        if (prs.length === 0) continue
        if (prs[0].merged_at) await this.onPrStateChanged(branch, 'merged', deps)
        else if (prs[0].state === 'open') await this.onPrStateChanged(branch, 'open', deps)
      } catch (err) {
        console.warn('[ticket-loop] poll failed', branch, err)
      }
    }
  }

  async onPrStateChanged(branch: string, pr: 'open' | 'merged', deps: PanelAdapterDeps): Promise<void> {
    const t = this.tracked.get(branch)
    if (!t) return
    // Only transition on a CHANGE of PR state: an open PR is seen by every
    // 90s poll cycle, and re-firing in_review each time means a transition
    // POST per cycle on Jira/Linear (rate-limit churn + workflow
    // notifications). If the transition fails we keep lastPr unset so the
    // next cycle retries.
    if (pr === 'open' && t.lastPr === 'open') return
    const p = this.provider(t.pluginId, deps)
    if (!p) return
    try {
      await p.transition(t.providerId, pr === 'open' ? 'in_review' : 'done')
      if (pr === 'merged') this.tracked.delete(branch)
      else this.tracked.set(branch, { ...t, lastPr: 'open' })
      this.saveTracked()
    } catch (err) {
      console.warn('[ticket-loop] transition on PR', pr, t.key, err)
    }
  }
}

export const ticketLoop = new TicketLoop()
