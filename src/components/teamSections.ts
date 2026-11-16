/**
 * The team workspace's left-nav sections, in nav order.
 *
 * Kept in its own module — with no React, no hooks and no supabase behind it —
 * so anything that needs to enumerate the sections (the tutorial-anchor check,
 * the keyboard chords) can import them without dragging TeamsWorkspace's whole
 * dependency tree along.
 *
 * Each section renders a nav button carrying `data-tour-id="teams-nav-<id>"`,
 * which is what makes this list the source of truth for those anchors.
 */
export const WORKSPACE_SECTIONS = [
  'chat', 'members', 'stats', 'snippets', 'workspaces', 'mcp',
] as const

export type WorkspaceSection = typeof WORKSPACE_SECTIONS[number]
