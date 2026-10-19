// Task 10 (Team Memory Layer 2): la data-fetching detras de <TeamThreadGraph>. Ese
// componente es prop-driven y puro a proposito (se testea sin IPC); este es el que sabe de
// donde salen esos props para la app real.
//
// projectKey SIEMPRE sale de `teamThreadProjectKeyForWorktree` (main resuelve del lado
// electron, mismo camino que `handoff:read` — src/ no puede reimplementar
// resolveProjectKey, necesita normalizar el remote y hashear). Nunca se calcula aca.
//
// Self-contained como MemoryVaultCard: no worktree activo -> no se muestra nada, no hay
// estado vacio que inventar. Un error de IPC SI se muestra (a diferencia de una version
// anterior de este archivo, que dejaba `ready` en false para siempre y el panel quedaba
// invisible — indistinguible de "no hay worktree activo"; review de Task 10, hallazgo 4):
// - si falla la carga inicial, no hay `enabled`/`branches` de los que fiarse -> se
//   reemplaza el panel entero por el error.
//
// Task 2 (mirar vs. configurar): projectKey/enabled salen de `useTeamThreadSettings`,
// compartido con `TeamThreadToggle`. Este panel sigue siendo el unico que necesita las
// ramas (para el grafo) — y ahora devuelve `null` si el hilo esta apagado, en vez de
// pasarle `enabled`/`onToggle` a TeamThreadGraph: prenderlo vive en la vista de settings.
import { useCallback, useEffect, useState } from 'react'
import { TeamThreadGraph } from './TeamThreadGraph'
import { useTeamThreadSettings } from '../hooks/useTeamThreadSettings'
import type { TeamThreadBranch } from '../types'

interface Props {
  activeRepoPath: string | null
  /** Mismo camino que ya usa el explorador de archivos para abrir un archivo en el
   *  editor (App.tsx's openFileInEditor, enhebrado hasta aca via Sidebar). */
  onOpenFile: (relPath: string) => void
}

const LOAD_ERROR = "Couldn't load the team thread. Try again in a moment."

export default function TeamThreadPanel({ activeRepoPath, onOpenFile }: Props) {
  const { ready: settingsReady, enabled, error: settingsError } = useTeamThreadSettings(activeRepoPath)
  const [branches, setBranches] = useState<TeamThreadBranch[]>([])
  const [focus, setFocus] = useState<string | null>(null)
  const [branchesReady, setBranchesReady] = useState(false)
  const [branchesError, setBranchesError] = useState<string | null>(null)

  const loadBranches = useCallback(async (worktreePath: string) => {
    try {
      const [readRes, gitInfo] = await Promise.all([
        window.memory?.teamThreadRead?.(worktreePath),
        window.git?.info?.(worktreePath),
      ])
      if (!readRes?.ok) { setBranchesError(LOAD_ERROR); setBranchesReady(true); return }
      const nextBranches = readRes.branches ?? []
      setBranches(nextBranches)
      // El foco es la rama del worktree activo: se busca por nombre de rama entre las filas
      // ya traidas (no hay que reimplementar branchSlug() en el renderer para esto).
      setFocus(gitInfo?.branch ? nextBranches.find((b) => b.branch === gitInfo.branch)?.slug ?? null : null)
      setBranchesError(null)
      setBranchesReady(true)
    } catch {
      setBranchesError(LOAD_ERROR)
      setBranchesReady(true)
    }
  }, [])

  useEffect(() => {
    if (!settingsReady || !activeRepoPath || !enabled) {
      setBranchesReady(true)
      return
    }
    setBranchesReady(false)
    setBranchesError(null)
    void loadBranches(activeRepoPath)
  }, [activeRepoPath, enabled, settingsReady, loadBranches])

  const handleOpenNote = useCallback((slug: string) => {
    // I2: `general` (las filas sin rama) NO vive en `ramas/`, sino en la raiz del hilo —
    // ver filePathFor() en electron/integrations/team-thread-plan.ts. Armar siempre
    // `ramas/<slug>.md` abria un path que no existe.
    onOpenFile(slug === 'general' ? '.nest/team/general.md' : `.nest/team/ramas/${slug}.md`)
  }, [onOpenFile])

  if (!activeRepoPath || !settingsReady) return null

  if (settingsError) {
    return (
      <div className="team-thread-error">
        <p>{settingsError}</p>
      </div>
    )
  }

  if (!enabled) return null

  if (!branchesReady) return null

  if (branchesError) {
    return (
      <div className="team-thread-error">
        <p>{branchesError}</p>
      </div>
    )
  }

  return (
    <div className="team-thread-panel">
      <TeamThreadGraph
        branches={branches}
        focus={focus}
        ahora={Date.now()}
        onOpenNote={handleOpenNote}
      />
    </div>
  )
}
