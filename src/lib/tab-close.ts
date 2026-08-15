/**
 * Whether closing a workspace tab should ask for confirmation first.
 *
 * A tab with running terminals of its own always confirms (they'd be killed).
 * The Hub is special: it owns no panes (`panes: []`) — its content is the
 * curated `hubPanes` set — so the panes check alone would let it close on a
 * single click and silently discard the curation. Guard that case too.
 */
export function shouldConfirmTabClose(tab: {
  panes: readonly unknown[]
  isHub?: boolean
  hubPanes?: readonly unknown[]
}): boolean {
  if (tab.panes.length > 0) return true
  return Boolean(tab.isHub) && (tab.hubPanes?.length ?? 0) > 0
}
