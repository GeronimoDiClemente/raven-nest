// Motor 3 (H4) — señales por worktree. Observa el estado de CI y de review de
// cada worktree vivo (token en main, credential-free vía deps) y lo expone por
// get() para la UI. Fuente única de la señal `ci.failed` del bus. No importa
// worktree-store ni electron: la lista de worktrees y la resolución de repo se
// inyectan (testeable en node puro).
import type { PanelAdapterDeps } from '../integration-panels'
import type { EventBus } from './event-bus'
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
    const prev = this.state.get(wt.repoPath)
    this.state.set(wt.repoPath, {
      ci,
      runId: failedRun?.id,
      runUrl: failedRun?.html_url,
      changesRequested: prev?.changesRequested ?? false,
      prNumber: prev?.prNumber,
    })
  }
}
