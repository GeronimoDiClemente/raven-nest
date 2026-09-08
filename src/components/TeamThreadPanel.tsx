// Task 10 (Team Memory Layer 2): la data-fetching detras de <TeamThreadGraph>. Ese
// componente es prop-driven y puro a proposito (se testea sin IPC); este es el que sabe de
// donde salen esos props para la app real.
//
// projectKey SIEMPRE sale de `teamThreadProjectKeyForWorktree` (main resuelve del lado
// electron, mismo camino que `handoff:read` — src/ no puede reimplementar
// resolveProjectKey, necesita normalizar el remote y hashear). Nunca se calcula aca.
//
// Self-contained como MemoryVaultCard: no worktree activo -> no se muestra nada, no hay
// estado vacio que inventar.
import { useCallback, useEffect, useState } from 'react'
import { TeamThreadGraph } from './TeamThreadGraph'
import type { TeamThreadBranch } from '../types'

interface Props {
  activeRepoPath: string | null
  /** Mismo camino que ya usa el explorador de archivos para abrir un archivo en el
   *  editor (App.tsx's openFileInEditor, enhebrado hasta aca via Sidebar). */
  onOpenFile: (relPath: string) => void
}

export default function TeamThreadPanel({ activeRepoPath, onOpenFile }: Props) {
  const [projectKey, setProjectKey] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [branches, setBranches] = useState<TeamThreadBranch[]>([])
  const [focus, setFocus] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const load = useCallback(async (worktreePath: string) => {
    const key = await window.memory?.teamThreadProjectKeyForWorktree?.(worktreePath)
    if (!key) { setReady(true); return }
    setProjectKey(key)

    const settingsRes = await window.memory?.teamThreadGetSettings?.(key)
    const isEnabled = settingsRes?.ok ? (settingsRes.settings?.enabled ?? false) : false
    setEnabled(isEnabled)

    if (!isEnabled) {
      setBranches([])
      setFocus(null)
      setReady(true)
      return
    }

    const [readRes, gitInfo] = await Promise.all([
      window.memory?.teamThreadRead?.(worktreePath),
      window.git?.info?.(worktreePath),
    ])
    const nextBranches = readRes?.ok ? (readRes.branches ?? []) : []
    setBranches(nextBranches)
    // El foco es la rama del worktree activo: se busca por nombre de rama entre las filas
    // ya traidas (no hay que reimplementar branchSlug() en el renderer para esto).
    setFocus(gitInfo?.branch ? nextBranches.find((b) => b.branch === gitInfo.branch)?.slug ?? null : null)
    setReady(true)
  }, [])

  useEffect(() => {
    setReady(false)
    if (activeRepoPath) void load(activeRepoPath)
    else setReady(true)
  }, [activeRepoPath, load])

  const handleToggle = useCallback(async (next: boolean) => {
    if (!activeRepoPath || !projectKey) return
    const res = await window.memory?.teamThreadSetSettings?.(projectKey, activeRepoPath, { enabled: next })
    if (!res?.ok) return
    setEnabled(next)
    if (next) void load(activeRepoPath)
    else { setBranches([]); setFocus(null) }
  }, [activeRepoPath, projectKey, load])

  const handleOpenNote = useCallback((slug: string) => {
    onOpenFile(`.nest/team/ramas/${slug}.md`)
  }, [onOpenFile])

  if (!activeRepoPath || !ready) return null

  return (
    <TeamThreadGraph
      branches={branches}
      focus={focus}
      ahora={Date.now()}
      enabled={enabled}
      onToggle={handleToggle}
      onOpenNote={handleOpenNote}
    />
  )
}
