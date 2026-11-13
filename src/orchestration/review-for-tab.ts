// Qué ramas en revisión se muestran en un tab: las del repo donde corría su coordinador. La
// entrada guarda ese repo (el cwd del coordinador al lanzar), y sobrevive a un reinicio aunque el
// pane del coordinador ya no exista — por eso se compara por carpeta y no por id de pane.
import type { OrchestrationReviewEntry, WorkspaceTab } from '../types'

const normal = (p: string): string => p.replace(/[\\/]+$/, '')

export function reviewEntriesForTab(
  entries: OrchestrationReviewEntry[],
  tab: Pick<WorkspaceTab, 'repoPath' | 'panes' | 'isHub'> | undefined,
): OrchestrationReviewEntry[] {
  if (!tab || tab.isHub) return []
  const carpetas = new Set<string>()
  if (tab.repoPath) carpetas.add(normal(tab.repoPath))
  for (const p of tab.panes) {
    // Un pane worker tiene su worktree como repoPath: no hace que el tab "sea" de ese repo.
    if (p.orchestration) continue
    for (const c of [p.repoPath, p.runningRepoPath]) if (c) carpetas.add(normal(c))
  }
  return entries.filter((e) => carpetas.has(normal(e.repoPath)))
}
