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
// - si falla el toggle, el grafo ya cargado sigue siendo valido -> se muestra un error
//   corto arriba, sin tapar el grafo.
import { useCallback, useEffect, useState } from 'react'
import { TeamThreadGraph } from './TeamThreadGraph'
import type { TeamThreadBranch } from '../types'

interface Props {
  activeRepoPath: string | null
  /** Mismo camino que ya usa el explorador de archivos para abrir un archivo en el
   *  editor (App.tsx's openFileInEditor, enhebrado hasta aca via Sidebar). */
  onOpenFile: (relPath: string) => void
}

const LOAD_ERROR = "Couldn't load the team thread. Try again in a moment."
const TOGGLE_ERROR = "Couldn't update the team thread setting. Try again in a moment."

export default function TeamThreadPanel({ activeRepoPath, onOpenFile }: Props) {
  const [projectKey, setProjectKey] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [branches, setBranches] = useState<TeamThreadBranch[]>([])
  const [focus, setFocus] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)

  const load = useCallback(async (worktreePath: string) => {
    try {
      const keyRes = await window.memory?.teamThreadProjectKeyForWorktree?.(worktreePath)
      if (!keyRes?.ok || !keyRes.projectKey) { setLoadError(LOAD_ERROR); setReady(true); return }
      const key = keyRes.projectKey
      setProjectKey(key)

      const settingsRes = await window.memory?.teamThreadGetSettings?.(key)
      if (!settingsRes?.ok) { setLoadError(LOAD_ERROR); setReady(true); return }
      const isEnabled = settingsRes.settings?.enabled ?? false
      setEnabled(isEnabled)

      if (!isEnabled) {
        setBranches([])
        setFocus(null)
        setLoadError(null)
        setReady(true)
        return
      }

      const [readRes, gitInfo] = await Promise.all([
        window.memory?.teamThreadRead?.(worktreePath),
        window.git?.info?.(worktreePath),
      ])
      if (!readRes?.ok) { setLoadError(LOAD_ERROR); setReady(true); return }
      const nextBranches = readRes.branches ?? []
      setBranches(nextBranches)
      // El foco es la rama del worktree activo: se busca por nombre de rama entre las filas
      // ya traidas (no hay que reimplementar branchSlug() en el renderer para esto).
      setFocus(gitInfo?.branch ? nextBranches.find((b) => b.branch === gitInfo.branch)?.slug ?? null : null)
      setLoadError(null)
      setReady(true)
    } catch {
      setLoadError(LOAD_ERROR)
      setReady(true)
    }
  }, [])

  useEffect(() => {
    setReady(false)
    setLoadError(null)
    setToggleError(null)
    if (activeRepoPath) void load(activeRepoPath)
    else setReady(true)
  }, [activeRepoPath, load])

  const handleToggle = useCallback(async (next: boolean) => {
    if (!activeRepoPath || !projectKey) return
    try {
      const res = await window.memory?.teamThreadSetSettings?.(projectKey, activeRepoPath, { enabled: next })
      // `message` viene cuando main tiene algo accionable que decir — hoy, que el plan de
      // la cuenta no admite compartir con el equipo (I1). Un codigo de error crudo no se
      // muestra nunca: para eso esta el texto generico.
      if (!res?.ok) { setToggleError(res?.message ?? TOGGLE_ERROR); return }
      setToggleError(null)
      setEnabled(next)
      if (next) void load(activeRepoPath)
      else { setBranches([]); setFocus(null) }
    } catch {
      setToggleError(TOGGLE_ERROR)
    }
  }, [activeRepoPath, projectKey, load])

  const handleOpenNote = useCallback((slug: string) => {
    // I2: `general` (las filas sin rama) NO vive en `ramas/`, sino en la raiz del hilo —
    // ver filePathFor() en electron/integrations/team-thread-plan.ts. Armar siempre
    // `ramas/<slug>.md` abria un path que no existe.
    onOpenFile(slug === 'general' ? '.nest/team/general.md' : `.nest/team/ramas/${slug}.md`)
  }, [onOpenFile])

  if (!activeRepoPath || !ready) return null

  if (loadError) {
    return (
      <div className="team-thread-error">
        <p>{loadError}</p>
      </div>
    )
  }

  return (
    <div className="team-thread-panel">
      {toggleError && (
        <div className="team-thread-error">
          <p>{toggleError}</p>
        </div>
      )}
      <TeamThreadGraph
        branches={branches}
        focus={focus}
        ahora={Date.now()}
        enabled={enabled}
        onToggle={handleToggle}
        onOpenNote={handleOpenNote}
      />
    </div>
  )
}
