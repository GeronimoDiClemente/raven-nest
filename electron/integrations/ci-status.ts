// Estado de CI derivado de los workflow runs de un branch. Extraído de
// src/hooks/useRepoCI.ts (misma semántica) para reusarlo en el main sin fetch.
export type CIStatus = 'success' | 'failure' | 'running' | 'unknown'

export interface WorkflowRun {
  id: number
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null
  html_url: string
  head_branch: string
}

/** El run más reciente (GitHub devuelve descendente por created_at) manda. */
export function runsToStatus(runs: WorkflowRun[]): CIStatus {
  const latest = runs[0]
  if (!latest) return 'unknown'
  if (latest.status === 'in_progress' || latest.status === 'queued') return 'running'
  if (latest.conclusion === 'success') return 'success'
  if (latest.conclusion === 'failure') return 'failure'
  return 'unknown'
}
