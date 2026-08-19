// src/lib/dragTypes.ts

/**
 * dataTransfer MIME set when dragging a worktree row onto the workspace to open
 * a terminal in that worktree's folder. Shared by the real workspace drop
 * handler (App.tsx), the real WorktreesSection drag source, and the tutorial's
 * interactive workspace mock — keep them reading one definition.
 */
export const WORKTREE_DRAG_MIME = 'application/x-raven-worktree-path'

/**
 * dataTransfer MIME set when dragging a file from the Explorer. Payload is
 * JSON `{ relPath, worktreePath }` — the worktree travels IN the payload and
 * is the authority on which file it is (a relPath under another worktree is
 * another file). Drop targets: an editor pane (opens the file there as a tab)
 * and the workspace background (opens a NEW editor pane, App.tsx).
 */
export const FILE_DRAG_MIME = 'application/x-nest-file'

/**
 * dataTransfer MIME set when dragging an editor TAB. Payload: JSON
 * `{ sourcePaneId, relPath, dirty, worktreePath }`. Drop targets: otro pane
 * de editor del mismo worktree (la tab se muda ahí), o el workspace — que
 * la mueve a un pane NUEVO (mismo gesto que el botón "Open in new pane").
 */
export const EDITOR_TAB_DRAG_MIME = 'application/x-nest-editor-tab'

export type WorkspaceDropAction =
  | { kind: 'worktree'; path: string }
  | { kind: 'file'; relPath: string; worktreePath: string }
  | { kind: 'editorTab'; sourcePaneId: string; relPath: string }

/**
 * Decoder ÚNICO del payload FILE_DRAG_MIME. Todo consumidor (EditorPane y el
 * drop del workspace) pasa por acá: dos decoders a mano para el mismo wire
 * format divergen en los edges (payload con relPath vacío, JSON roto).
 * null = payload ajeno o inválido — no es nuestro drop.
 */
export function decodeFileDrag(raw: string): { relPath: string; worktreePath: string } | null {
  try {
    const p = JSON.parse(raw) as { relPath?: string; worktreePath?: string }
    if (typeof p.relPath === 'string' && p.relPath && typeof p.worktreePath === 'string' && p.worktreePath) {
      return { relPath: p.relPath, worktreePath: p.worktreePath }
    }
  } catch { /* payload ajeno o roto */ }
  return null
}

/** Whether a drag hovering the workspace carries a payload we can drop. */
export function workspaceAcceptsDrag(types: readonly string[]): boolean {
  return types.includes(WORKTREE_DRAG_MIME) || types.includes(FILE_DRAG_MIME) || types.includes(EDITOR_TAB_DRAG_MIME)
}

/**
 * dropEffect para un drag aceptado. DEBE matchear el effectAllowed del
 * ORIGEN ('move' en tabs, 'copy' en archivos/worktrees) o Chromium invalida
 * el drop en silencio. Única fuente del pareo: el dragover del workspace
 * burbujea después del de cada pane y PISA su dropEffect — si divergen, la
 * mudanza de tabs muere (regresión real del 2026-08-18).
 */
export function workspaceDropEffect(types: readonly string[]): 'move' | 'copy' {
  return types.includes(EDITOR_TAB_DRAG_MIME) ? 'move' : 'copy'
}

/**
 * Decode the workspace-level drop into an action, or null for payloads we
 * don't own (OS file drags, text selections, malformed JSON).
 */
export function workspaceDropAction(dt: Pick<DataTransfer, 'getData'>): WorkspaceDropAction | null {
  const worktreePath = dt.getData(WORKTREE_DRAG_MIME)
  if (worktreePath) return { kind: 'worktree', path: worktreePath }
  const fileRaw = dt.getData(FILE_DRAG_MIME)
  if (fileRaw) {
    const file = decodeFileDrag(fileRaw)
    if (file) return { kind: 'file', ...file }
  }
  const tabRaw = dt.getData(EDITOR_TAB_DRAG_MIME)
  if (tabRaw) {
    try {
      const p = JSON.parse(tabRaw) as { sourcePaneId?: string; relPath?: string }
      if (typeof p.sourcePaneId === 'string' && p.sourcePaneId && typeof p.relPath === 'string' && p.relPath) {
        return { kind: 'editorTab', sourcePaneId: p.sourcePaneId, relPath: p.relPath }
      }
    } catch { /* payload ajeno o roto */ }
  }
  return null
}
