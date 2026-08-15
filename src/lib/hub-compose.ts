import type { PaneNode } from '../types'

// One terminal as it appears in the Hub: the live pane plus its origin
// workspace and runtime flags. accentColor drives the group-header dot.
export interface HubEntry {
  pane: PaneNode
  tabId: string
  tabName: string
  accentColor?: string
  isActiveTab: boolean
  busy: boolean
}

// Cross-cutting Hub filters. There is NO per-workspace filter chip: the
// per-workspace view is the grouping itself (see composeHubGroups).
export type HubFilter = 'all' | 'active' | 'pinned'

export function filterEntries(entries: HubEntry[], filter: HubFilter): HubEntry[] {
  if (filter === 'active') return entries.filter(e => e.busy)
  if (filter === 'pinned') return entries.filter(e => e.pane.pinned)
  return entries  // 'all'
}

export interface HubGroup {
  tabId: string
  tabName: string
  accentColor?: string
  entries: HubEntry[]   // shown (not hidden) terminals, in source order
  hiddenCount: number   // terminals hidden by the user in this workspace
}

export interface HubComposition {
  groups: HubGroup[]
  shown: number
  hidden: number
  counts: { all: number; active: number; pinned: number }
}

// Compose the Hub grid. The Hub is a filterable VIEW of terminals across every
// workspace: apply the cross-cutting chip filter, then split by the user's
// per-terminal show/hide set, grouped by source workspace (in the order the
// workspaces first appear). Nothing is capped — the Hub scrolls. A workspace
// whose terminals are all hidden still yields an (empty) group so it can be
// re-shown from the header.
export function composeHubGroups(
  entries: HubEntry[],
  filter: HubFilter,
  hidden: ReadonlySet<string>,
): HubComposition {
  const counts = {
    all: entries.length,
    active: entries.filter(e => e.busy).length,
    pinned: entries.filter(e => e.pane.pinned).length,
  }
  const chip = filterEntries(entries, filter)
  const groups: HubGroup[] = []
  const byTab = new Map<string, HubGroup>()
  let shown = 0
  let hiddenTotal = 0
  for (const e of chip) {
    let g = byTab.get(e.tabId)
    if (!g) {
      g = { tabId: e.tabId, tabName: e.tabName, accentColor: e.accentColor, entries: [], hiddenCount: 0 }
      byTab.set(e.tabId, g)
      groups.push(g)
    }
    if (hidden.has(e.pane.id)) { g.hiddenCount++; hiddenTotal++ }
    else { g.entries.push(e); shown++ }
  }
  return { groups, shown, hidden: hiddenTotal, counts }
}
