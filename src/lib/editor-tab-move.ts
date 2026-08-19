import type { LayoutId, PaneNode, WorkspaceTab } from '../types'
import { AI_CONFIG } from '../types'
import { defaultLayoutFor } from '../layout/select'
import { getPreset } from '../layout/presets'
import { sameWorktree } from './worktree-path'

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
  // sameWorktree: C:\repo y C:/repo (dos productores de repoPath) son el
  // mismo worktree — la comparación cruda rechazaba el move en Windows. El
  // === conserva el caso legacy de workspaces guardados: dos panes SIN
  // repoPath (loadWorkspace no backfillea) siempre pudieron moverse entre sí.
  if (source.repoPath !== dest.repoPath && !sameWorktree(source.repoPath, dest.repoPath)) return null
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

export interface CrossMoveResult {
  tabs: WorkspaceTab[]
  dropStash: boolean
}

// Mudanza de una tab entre panes que pueden vivir en WORKSPACES DISTINTOS —
// el caso del Hub, que muestra panes de todos lados. Misma semántica que
// moveTabBetweenPanes (merge limpio, no-merge con buffers divergentes,
// rechazo cross-worktree, remoción del pane origen vaciado con demote de
// layout) más: el pane removido sale de hubPanes de cualquier tab Hub.
export function moveTabAcrossWorkspaces(
  tabs: readonly WorkspaceTab[],
  sourcePaneId: string,
  destPaneId: string,
  relPath: string,
  dirty: boolean,
): CrossMoveResult | null {
  if (sourcePaneId === destPaneId) return null
  const sourceTab = tabs.find((t) => !t.isHub && t.panes.some((p) => p.id === sourcePaneId))
  const destTab = tabs.find((t) => !t.isHub && t.panes.some((p) => p.id === destPaneId))
  if (!sourceTab || !destTab) return null
  const source = sourceTab.panes.find((p) => p.id === sourcePaneId)!
  const dest = destTab.panes.find((p) => p.id === destPaneId)!
  if (source.aiType !== 'editor' || dest.aiType !== 'editor') return null
  if (source.repoPath !== dest.repoPath && !sameWorktree(source.repoPath, dest.repoPath)) return null
  if (!(source.editorTabs ?? []).some((t) => t.relPath === relPath)) return null

  const destTabs = dest.editorTabs ?? []
  const destHasFile = destTabs.some((t) => t.relPath === relPath)

  if (destHasFile && dirty) {
    // Buffers divergentes: activar la copia del destino, el origen no se toca.
    return {
      tabs: tabs.map((t) => t.id === destTab.id
        ? { ...t, panes: t.panes.map((p) => (p.id === destPaneId ? { ...p, activeEditorTabPath: relPath } : p)) }
        : t),
      dropStash: false,
    }
  }

  let removedSourcePane = false
  const nextTabs = tabs.map((t) => {
    let panes = t.panes
    if (t.id === sourceTab.id) {
      panes = panes.flatMap((p) => {
        if (p.id !== sourcePaneId) return [p]
        const remaining = (p.editorTabs ?? []).filter((tb) => tb.relPath !== relPath)
        if (remaining.length === 0) { removedSourcePane = true; return [] }
        return [{
          ...p,
          editorTabs: remaining,
          activeEditorTabPath: p.activeEditorTabPath === relPath ? remaining[0]?.relPath : p.activeEditorTabPath,
        }]
      })
    }
    if (t.id === destTab.id) {
      panes = panes.map((p) => {
        if (p.id !== destPaneId) return p
        const editorTabs = destHasFile ? destTabs : [...destTabs, { relPath, dirty }]
        return { ...p, editorTabs, activeEditorTabPath: relPath }
      })
    }
    if (panes === t.panes) return t
    // Demote SOLO cuando el workspace perdió un pane (source vaciado): un tab
    // que sólo cambió sus editorTabs (el destino, o el source con tabs
    // restantes) reconstruye igual su array de panes, y degradarlo colapsaba el
    // layout holgado y borraba los splitRatios custom del usuario sin motivo.
    if (panes.length >= t.panes.length) return { ...t, panes }
    const naturalDefault = defaultLayoutFor(panes.length)
    const demoted = getPreset(naturalDefault).slotCount < getPreset(t.layoutId).slotCount
    const layoutId: LayoutId = demoted ? naturalDefault : t.layoutId
    return demoted
      ? { ...t, panes, layoutId, splitRatios: {} }
      : { ...t, panes, layoutId }
  }).map((t) => (t.isHub && removedSourcePane && (t.hubPanes ?? []).includes(sourcePaneId)
    ? { ...t, hubPanes: (t.hubPanes ?? []).filter((id) => id !== sourcePaneId) }
    : t))

  return { tabs: nextTabs, dropStash: destHasFile }
}

// "Open in new pane" invocado DESDE el Hub: el pane origen vive en otro
// workspace (el Hub no posee panes), así que el split se crea EN el
// workspace de origen y se auto-pinnea al Hub — el usuario lo ve aparecer
// donde está mirando, igual que el patrón de abrir un browser desde el Hub.
// El buffer sin guardar viaja por editor-buffer-handoff (el EditorPane
// origen stashea antes de invocar el gesto), acá solo viaja la metadata.
export function splitEditorTabFromHub(
  tabs: readonly WorkspaceTab[],
  hubTabId: string,
  sourcePaneId: string,
  relPath: string,
  newPaneId: string,
): WorkspaceTab[] | null {
  const sourceTab = tabs.find((t) => !t.isHub && t.panes.some((p) => p.id === sourcePaneId))
  if (!sourceTab) return null
  const sourcePane = sourceTab.panes.find((p) => p.id === sourcePaneId)!
  if (sourcePane.aiType !== 'editor') return null
  const paneTabs = sourcePane.editorTabs ?? []
  // Única tab: mover "a un pane nuevo" es un no-op conceptual.
  if (paneTabs.length <= 1) return null
  const movedTab = paneTabs.find((tb) => tb.relPath === relPath)
  if (!movedTab) return null

  const newPane: PaneNode = {
    id: newPaneId, aiType: 'editor', accountName: '', accountDir: '',
    borderColor: AI_CONFIG.editor.color, cmd: '',
    repoPath: sourcePane.repoPath,
    editorTabs: [{ relPath, dirty: movedTab.dirty }],
    activeEditorTabPath: relPath,
  }
  return tabs.map((t) => {
    if (t.id === sourceTab.id) {
      const remaining = paneTabs.filter((tb) => tb.relPath !== relPath)
      const nextPanes = t.panes
        .map((p) => p.id === sourcePaneId
          ? { ...p, editorTabs: remaining, activeEditorTabPath: p.activeEditorTabPath === relPath ? remaining[0]?.relPath : p.activeEditorTabPath }
          : p)
        .concat(newPane)
      // Promoción de layout del workspace origen — mismo patrón que addPane.
      const promoted = nextPanes.length > getPreset(t.layoutId).slotCount
      const layoutId: LayoutId = promoted ? defaultLayoutFor(nextPanes.length) : t.layoutId
      return promoted
        ? { ...t, panes: nextPanes, layoutId, splitRatios: {} }
        : { ...t, panes: nextPanes, layoutId }
    }
    if (t.id === hubTabId && t.isHub) {
      return { ...t, hubPanes: [...(t.hubPanes ?? []), newPaneId] }
    }
    return t
  })
}

// Saca una tab de un pane de editor. La vista activa SÓLO se mueve si la tab
// removida era la activa; sacar una tab de fondo no debe saltar lo que el
// usuario está mirando (mismo criterio que moveTabBetweenPanes/AcrossWorkspaces).
export function removeEditorTab(pane: PaneNode, relPath: string): PaneNode {
  const remaining = (pane.editorTabs ?? []).filter((t) => t.relPath !== relPath)
  return {
    ...pane,
    editorTabs: remaining,
    activeEditorTabPath: pane.activeEditorTabPath === relPath ? remaining[0]?.relPath : pane.activeEditorTabPath,
  }
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
