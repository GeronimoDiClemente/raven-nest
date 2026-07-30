// Motor 3 (H4) — señales por worktree. Observa el estado de CI y de review de
// cada worktree vivo (token en main, credential-free vía deps) y lo expone por
// get() para la UI. Fuente única de la señal `ci.failed` del bus. No importa
// worktree-store ni electron: la lista de worktrees y la resolución de repo se
// inyectan (testeable en node puro).
import type { PanelAdapterDeps } from '../integration-panels'
import type { EventBus } from './event-bus'
import type { DomainEvent } from './bus-types'
import { runsToStatus, type CIStatus, type WorkflowRun } from './ci-status'

const FAILED_CI_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', 'timed_out', 'startup_failure'])
const GH = 'https://api.github.com'

export interface WorktreeInput { repoPath: string; branch: string }

export interface WorktreeSignal {
  ci: CIStatus
  runId?: number
  runUrl?: string
  changesRequested: boolean
  prNumber?: number
  /** "owner/repo" resuelto en el poll — lo necesita fixCiPrompt para bajar el log. */
  repo?: string
}

/** repoPath → "owner/repo" | null (no-GitHub). En main: getRemoteUrl+parseOwnerRepo. */
export type ResolveRepo = (repoPath: string) => string | null

export class WorktreeSignals {
  private state = new Map<string, WorktreeSignal>()
  private ciNotified = new Map<string, string>() // repoPath → sha ya emitido
  private bus?: EventBus

  constructor(private resolveRepo: ResolveRepo) {}

  attachBus(bus?: EventBus): void { this.bus = bus }
  get(repoPath: string): WorktreeSignal | undefined { return this.state.get(repoPath) }
  list(): Array<{ repoPath: string } & WorktreeSignal> {
    return [...this.state].map(([repoPath, s]) => ({ repoPath, ...s }))
  }

  private async gh<T>(deps: PanelAdapterDeps, path: string): Promise<T | null> {
    const res = await deps.fetch(`${GH}${path}`, {
      headers: { Authorization: `Bearer ${deps.getToken('github')}`, Accept: 'application/vnd.github.v3+json' },
    })
    if (!res.ok) return null
    return res.json() as Promise<T>
  }

  async poll(worktrees: WorktreeInput[], deps: PanelAdapterDeps): Promise<void> {
    for (const wt of worktrees) {
      const repo = this.resolveRepo(wt.repoPath)
      if (!repo) continue
      try {
        await this.pollOne(wt, repo, deps)
      } catch (err) {
        console.warn('[worktree-signals] poll failed', wt.repoPath, err)
      }
    }
  }

  private async pollOne(wt: WorktreeInput, repo: string, deps: PanelAdapterDeps): Promise<void> {
    const runsJson = await this.gh<{ workflow_runs?: WorkflowRun[] }>(
      deps, `/repos/${repo}/actions/runs?branch=${encodeURIComponent(wt.branch)}&per_page=5`,
    )
    const runs = runsJson?.workflow_runs ?? []
    const ci = runsToStatus(runs)
    const failedRun = runs.find((r) => r.status === 'completed' && FAILED_CI_CONCLUSIONS.has(r.conclusion ?? ''))

    // PR abierto del branch → número + reviews (changes requested).
    let changesRequested = false
    let prNumber: number | undefined
    const owner = repo.split('/')[0]
    const pulls = await this.gh<Array<{ number: number; head: { ref: string } }>>(
      deps, `/repos/${repo}/pulls?head=${encodeURIComponent(owner + ':' + wt.branch)}&state=open&per_page=1`,
    )
    const pr = pulls?.[0]
    if (pr) {
      prNumber = pr.number
      const reviews = await this.gh<Array<{ user: { login: string } | null; state: string; submitted_at: string }>>(
        deps, `/repos/${repo}/pulls/${pr.number}/reviews`,
      )
      changesRequested = latestReviewIsChangesRequested(reviews ?? [])
    }
    const prev = this.state.get(wt.repoPath)
    this.state.set(wt.repoPath, { ci, repo, runId: failedRun?.id, runUrl: failedRun?.html_url, changesRequested, prNumber })

    // changes.requested: emitir SOLO en la transición a true (no en cada ciclo).
    if (this.bus && changesRequested && !prev?.changesRequested && prNumber) {
      const ev: DomainEvent = { type: 'changes.requested', branch: wt.branch, repoFullName: repo, prNumber }
      await this.bus.emit(ev, deps)
    }

    // Señal ci.failed (bus, aditiva, dedup por SHA del run rojo).
    const sha = (failedRun as { head_sha?: string } | undefined)?.head_sha
    if (this.bus && failedRun && sha && this.ciNotified.get(wt.repoPath) !== sha) {
      this.ciNotified.set(wt.repoPath, sha)
      const ev: DomainEvent = {
        type: 'ci.failed', branch: wt.branch, repoFullName: repo,
        ...(failedRun.html_url ? { runUrl: failedRun.html_url } : {}),
        ...(failedRun.name ? { summary: failedRun.name } : {}),
      }
      await this.bus.emit(ev, deps)
    }
  }

  async fixCiPrompt(repoPath: string, deps: PanelAdapterDeps): Promise<string | null> {
    const sig = this.state.get(repoPath)
    if (!sig?.runId || !sig.repo) return null
    const jobs = await this.gh<{ jobs?: Array<{ id: number; conclusion: string | null }> }>(
      deps, `/repos/${sig.repo}/actions/runs/${sig.runId}/jobs`,
    )
    const failedJob = (jobs?.jobs ?? []).find((j) => j.conclusion === 'failure')
    let log = ''
    if (failedJob) {
      const res = await deps.fetch(`${GH}/repos/${sig.repo}/actions/jobs/${failedJob.id}/logs`, {
        headers: { Authorization: `Bearer ${deps.getToken('github')}`, Accept: 'application/vnd.github.v3+json' },
      })
      if (res.ok) log = truncateTail(await res.text(), 200)
    }
    return [
      `El CI de este branch (${sig.runUrl ?? 'run'}) está en rojo. Arreglá lo que rompió.`,
      log ? `\nÚltimas líneas del log del job fallido:\n\`\`\`\n${log}\n\`\`\`` : '',
    ].join('\n')
  }
}

export function truncateTail(text: string, maxLines: number): string {
  const lines = text.split('\n')
  return lines.length <= maxLines ? text : lines.slice(-maxLines).join('\n')
}

// El review que cuenta es el más reciente por autor: un CHANGES_REQUESTED viejo
// que ya fue re-aprobado no debe marcar el PR. Sólo estados de decisión
// (APPROVED/CHANGES_REQUESTED) pisan; COMMENTED/DISMISSED se ignoran.
export function latestReviewIsChangesRequested(
  reviews: Array<{ user: { login: string } | null; state: string; submitted_at: string }>,
): boolean {
  const byAuthor = new Map<string, string>()
  for (const r of [...reviews].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))) {
    const login = r.user?.login
    if (!login) continue
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED') byAuthor.set(login, r.state)
  }
  return [...byAuthor.values()].includes('CHANGES_REQUESTED')
}
