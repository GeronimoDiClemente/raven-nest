// src/lib/dragTypes.ts

/**
 * dataTransfer MIME set when dragging a worktree row onto the workspace to open
 * a terminal in that worktree's folder. Shared by the real workspace drop
 * handler (App.tsx), the real WorktreesSection drag source, and the tutorial's
 * interactive workspace mock — keep them reading one definition.
 */
export const WORKTREE_DRAG_MIME = 'application/x-raven-worktree-path'
