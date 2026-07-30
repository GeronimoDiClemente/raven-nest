import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { PanelAdapterDeps } from './integration-panels'
import type { Ticket, TicketProvider, TicketProviderFactory } from './integrations/ticket-types'
import type { EventBus } from './integrations/event-bus'
import type { DomainEvent } from './integrations/bus-types'

// Conclusiones de un check-run de GitHub que cuentan como "CI rojo". 'cancelled'
// y 'skipped' se excluyen a propósito: no son una rotura real que amerite avisar.
const FAILED_CI_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', 'timed_out', 'startup_failure'])

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
  /**
   * Bus de eventos OPCIONAL. Sin bus (undefined) el loop se comporta idéntico a
   * H3 (transición directa por provider). Con bus, onPrStateChanged EMITE
   * pr.opened/pr.merged y el handler updateStatus hace la transición. Se adjunta
   * por setter (attachBus), no por constructor, para preservar la firma zero-arg
   * `new TicketLoop()` que usan los 14+ tests. El singleton nace sin bus; sólo el
   * wiring de main (T7) lo cablea.
   */
  private bus?: EventBus
  /**
   * Dedupe en memoria de la señal CI (Motor 3): branch → SHA del último commit
   * rojo ya emitido. Evita re-emitir `ci.failed` en cada ciclo de poll (90s)
   * para el mismo rojo (spam de notify). Un commit NUEVO rojo (otro SHA) sí
   * vuelve a emitir. No se persiste: el churn a evitar es dentro de una sesión.
   */
  private ciNotified = new Map<string, string>()

  register(pluginId: string, factory: TicketProviderFactory): void {
    this.factories.set(pluginId, factory)
  }

  /** Adjunta (o desadjunta con undefined) el bus de eventos. Ver campo `bus`. */
  attachBus(bus?: EventBus): void {
    this.bus = bus
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
        this.ciNotified.delete(branch)
        mutated = true
      }
    }
    if (mutated) this.saveTracked()
  }

  private provider(pluginId: string, deps: PanelAdapterDeps) {
    const f = this.factories.get(pluginId)
    return f ? f(deps) : null
  }

  /**
   * Resuelve el provider de un pluginId con las deps inyectadas (o null si no hay
   * factory registrada). Público para que los handlers del bus (bus-commands.ts)
   * reusen el mismo registry sin duplicarlo ni tocar los paths H3. Aditivo: no
   * altera onPrStateChanged/startWork.
   */
  providerFor(pluginId: string, deps: PanelAdapterDeps): TicketProvider | null {
    return this.provider(pluginId, deps)
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
    // Bus opcional: ADITIVO, no reemplaza. La transición a in_progress ya se hizo
    // directa arriba (sincrónica, esperada por los tests). Con bus, además
    // emitimos task.created + session.opened para observabilidad/motores futuros.
    // No hay doble transición: la receta de task.created es no-op en v1.
    if (this.bus) {
      const created: DomainEvent = {
        type: 'task.created',
        taskId: ticket.key,
        pluginId,
        providerId: ticket.providerId,
        repoFullName,
        branch,
        title: ticket.title,
      }
      await this.bus.emit(created, deps)
      const opened: DomainEvent = {
        // repoPath real vive en main (worktree:create); acá no lo conocemos.
        // Ninguna receta v1 consume session.opened, así que el valor no es load-bearing.
        type: 'session.opened',
        branch,
        repoPath: '',
        pluginId,
        providerId: ticket.providerId,
      }
      await this.bus.emit(opened, deps)
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
        const prs = await res.json() as Array<{ state: string; merged_at: string | null; head?: { sha?: string } }>
        if (prs.length === 0) continue
        if (prs[0].merged_at) await this.onPrStateChanged(branch, 'merged', deps)
        else if (prs[0].state === 'open') {
          await this.onPrStateChanged(branch, 'open', deps)
          // Motor 3 (bus-only, aditivo): con el PR abierto, mirar los checks del
          // HEAD y emitir ci.failed si está rojo. Sin bus no se consulta (path
          // H3 verbatim). Va DESPUÉS de onPrStateChanged, que ya destrackeó si
          // hubiese sido merge; acá el branch sigue vivo (open).
          if (this.bus) await this.checkCi(branch, repoFullName, prs[0].head?.sha, deps)
        }
      } catch (err) {
        console.warn('[ticket-loop] poll failed', branch, err)
      }
    }
  }

  /**
   * Motor 3 — señal CI. Consulta los check-runs del commit `sha` (HEAD del PR
   * abierto del branch propio) y, si alguno completó en rojo, emite `ci.failed`
   * por el bus (receta futura: ci.failed → notify con botón "que el agente
   * arregle el rojo"). Sólo GitHub, credential-free (token vía deps). Dedupe por
   * SHA para no spamear en cada ciclo de poll. Best-effort: cualquier fallo de
   * red se propaga al try/catch de pollOnce (no rompe el resto de branches).
   */
  private async checkCi(branch: string, repoFullName: string, sha: string | undefined, deps: PanelAdapterDeps): Promise<void> {
    if (!this.bus || !sha) return
    const res = await deps.fetch(
      `https://api.github.com/repos/${repoFullName}/commits/${encodeURIComponent(sha)}/check-runs`,
      { headers: { Authorization: `Bearer ${deps.getToken('github')}`, Accept: 'application/vnd.github.v3+json' } },
    )
    if (!res.ok) return
    const data = await res.json() as {
      check_runs?: Array<{ name?: string; status?: string; conclusion?: string | null; html_url?: string; details_url?: string }>
    }
    const failed = (data.check_runs ?? []).filter(
      (r) => r.status === 'completed' && FAILED_CI_CONCLUSIONS.has(r.conclusion ?? ''),
    )
    if (failed.length === 0) return
    // Ya avisamos este mismo commit rojo → no re-emitir (evita spam de notify).
    if (this.ciNotified.get(branch) === sha) return
    this.ciNotified.set(branch, sha)
    const summary = failed.map((r) => r.name).filter((n): n is string => !!n).join(', ')
    const runUrl = failed[0].html_url ?? failed[0].details_url
    const ev: DomainEvent = {
      type: 'ci.failed',
      branch,
      repoFullName,
      ...(runUrl ? { runUrl } : {}),
      ...(summary ? { summary } : {}),
    }
    await this.bus.emit(ev, deps)
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
    // Rama con bus (OPCIONAL): reemplaza la transición directa por un emit.
    // El emit va SIEMPRE antes del delete/set para que el `then(ev)` de la receta
    // pueda resolver branch→ticket mientras el tracking sigue vivo. El handler
    // updateStatus (registrado en main/T5) hace la transición real. Se conserva
    // arriba el guard lastPr, así que tampoco se re-emite pr.opened cada ciclo.
    if (this.bus) {
      const ev: DomainEvent = pr === 'open'
        ? { type: 'pr.opened', branch, repoFullName: t.repoFullName ?? '' }
        : { type: 'pr.merged', branch, repoFullName: t.repoFullName ?? '' }
      const { failed } = await this.bus.emit(ev, deps)
      // Retry parity con H3: sólo damos por hecha la transición —destrackear en
      // merge, marcar lastPr en open— si el updateStatus de ESTE ticket NO falló.
      // El emit es best-effort y traga los errores del handler, así que sin esto
      // un 500 transitorio de Jira/Linear dejaría el ticket stuck (tracking
      // borrado, nunca llega a Done). Si falló, dejamos el tracking intacto para
      // que el próximo poll re-emita y reintente, igual que el path sin-bus.
      const statusFailed = failed.some(
        (c) => c.cmd === 'updateStatus' && c.pluginId === t.pluginId && c.providerId === t.providerId,
      )
      if (!statusFailed) {
        if (pr === 'merged') this.tracked.delete(branch)
        else this.tracked.set(branch, { ...t, lastPr: 'open' })
        this.saveTracked()
      }
      return
    }
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
