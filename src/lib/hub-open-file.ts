// Abrir un archivo desde el Explorer multi-raíz del Hub.
//
// El archivo vive en su WORKSPACE (un pane de editor real ahí), y además se
// ancla al Hub (auto-pin) para verlo sin salir de la vista Hub. Esta función
// es la transformación pura de `tabs`; el caller (App) construye el pane nuevo
// candidato (id + defaults de editor) y aplica el resultado con setTabs.
import type { PaneNode, WorkspaceTab } from '../types'
import { sameWorktree } from './worktree-path'
import { getPreset } from '../layout/presets'
import { defaultLayoutFor } from '../layout/select'
import type { LayoutId } from '../types'

export interface OpenFileFromHubResult {
  tabs: WorkspaceTab[]
  paneId: string   // pane (reusado o creado) que quedó mostrando el archivo; '' si el workspace no existe
}

/**
 * Abre `relPath` (del worktree `repoPath`) en el workspace `workspaceTabId`:
 * reusa un pane de editor del mismo worktree o crea uno con `newPane`, y ancla
 * ese pane al Hub `hubTabId` (auto-pin). Idempotente en tabs y en hubPanes.
 */
export function openFileFromHub(
  tabs: WorkspaceTab[],
  hubTabId: string,
  workspaceTabId: string,
  repoPath: string,
  relPath: string,
  newPane: PaneNode,
): OpenFileFromHubResult {
  const ws = tabs.find(t => t.id === workspaceTabId)
  if (!ws) return { tabs, paneId: '' }

  const reused = ws.panes.find(p => p.aiType === 'editor' && sameWorktree(p.repoPath, repoPath))
  const paneId = reused?.id ?? newPane.id

  const nextTabs = tabs.map(t => {
    if (t.id === workspaceTabId) {
      if (reused) {
        return {
          ...t,
          panes: t.panes.map(p => {
            if (p.id !== reused.id) return p
            const existing = p.editorTabs ?? []
            const editorTabs = existing.some(tab => tab.relPath === relPath)
              ? existing
              : [...existing, { relPath, dirty: false }]
            return { ...p, editorTabs, activeEditorTabPath: relPath }
          }),
        }
      }
      // Crear el pane de editor en el workspace. Promocionar el layoutId si el
      // pane nuevo desborda el preset actual (mismo criterio que addPane): al
      // cambiar de layout se limpian los splitRatios, que pertenecen a la forma
      // vieja del árbol y dejarían slots en tamaños degenerados.
      const nextPanes = [...t.panes, newPane]
      const promoted = nextPanes.length > getPreset(t.layoutId).slotCount
      const layoutId: LayoutId = promoted ? defaultLayoutFor(nextPanes.length) : t.layoutId
      return promoted
        ? { ...t, panes: nextPanes, layoutId, splitRatios: {} }
        : { ...t, panes: nextPanes, layoutId }
    }
    if (t.id === hubTabId) {
      const cur = t.hubPanes ?? []
      return cur.includes(paneId) ? t : { ...t, hubPanes: [...cur, paneId] }
    }
    return t
  })

  return { tabs: nextTabs, paneId }
}
