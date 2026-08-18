import type { PaneNode } from '../types'

// Lógica pura de la mudanza de tabs entre panes de editor (drag & drop y
// futuros gestos). El buffer sin guardar viaja aparte, por
// editor-buffer-handoff: acá solo se muda la METADATA de la tab.

export interface MoveResult {
  panes: PaneNode[]
  // true → el caller debe descartar el stash del handoff: el destino ya
  // tenía el archivo abierto (con su propio buffer) y no va a consumirlo.
  dropStash: boolean
}

export function moveTabBetweenPanes(
  panes: readonly PaneNode[],
  sourcePaneId: string,
  destPaneId: string,
  relPath: string,
  dirty: boolean,
): MoveResult | null {
  if (sourcePaneId === destPaneId) return null
  const source = panes.find((p) => p.id === sourcePaneId)
  const dest = panes.find((p) => p.id === destPaneId)
  if (!source || !dest) return null
  if (source.aiType !== 'editor' || dest.aiType !== 'editor') return null
  // relPath es relativo al worktree del pane: en otro worktree apunta a OTRO
  // archivo (o a ninguno) — una mudanza cross-worktree no tiene semántica.
  if (source.repoPath !== dest.repoPath) return null
  if (!(source.editorTabs ?? []).some((t) => t.relPath === relPath)) return null

  const destTabs = dest.editorTabs ?? []
  const destHasFile = destTabs.some((t) => t.relPath === relPath)

  // Dos buffers divergentes del mismo archivo: fusionar descartaría uno de
  // los dos. Se activa la copia del destino y la tab origen NO se mueve.
  if (destHasFile && dirty) {
    return {
      panes: panes.map((p) => (p.id === destPaneId ? { ...p, activeEditorTabPath: relPath } : p)),
      dropStash: false, // el origen conserva su tab; su dragend limpia el stash
    }
  }

  const nextPanes = panes.flatMap((p) => {
    if (p.id === sourcePaneId) {
      const remaining = (p.editorTabs ?? []).filter((t) => t.relPath !== relPath)
      // La tab movida era la última: el pane origen se va (sin esto quedaba
      // un cascarón sin tabs — negro, incerrable).
      if (remaining.length === 0) return []
      return [{
        ...p,
        editorTabs: remaining,
        activeEditorTabPath: p.activeEditorTabPath === relPath ? remaining[0]?.relPath : p.activeEditorTabPath,
      }]
    }
    if (p.id === destPaneId) {
      const editorTabs = destHasFile ? destTabs : [...destTabs, { relPath, dirty }]
      return [{ ...p, editorTabs, activeEditorTabPath: relPath }]
    }
    return [p]
  })
  return { panes: nextPanes, dropStash: destHasFile }
}

// Drop de un archivo del Explorer sobre un pane de editor concreto: lo abre
// (o lo activa) AHÍ, no en el último pane enfocado.
export function openFileInPane(panes: readonly PaneNode[], paneId: string, relPath: string): PaneNode[] {
  return panes.map((p) => {
    if (p.id !== paneId || p.aiType !== 'editor') return p
    const tabs = p.editorTabs ?? []
    const exists = tabs.some((t) => t.relPath === relPath)
    return {
      ...p,
      editorTabs: exists ? tabs : [...tabs, { relPath, dirty: false }],
      activeEditorTabPath: relPath,
    }
  })
}
