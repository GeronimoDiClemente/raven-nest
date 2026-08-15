import { describe, it, expect } from 'vitest'
import { composeHubGroups, type HubEntry } from '../../lib/hub-compose'
import type { PaneNode } from '../../types'

// Minimal pane; only the fields the composer reads.
const pane = (id: string, extra: Partial<PaneNode> = {}): PaneNode => ({
  id, aiType: 'terminal', accountName: '', accountDir: '', borderColor: '#888', cmd: '', ...extra,
})

const entry = (
  id: string, tabId: string, tabName: string,
  opts: { busy?: boolean; pinned?: boolean } = {},
): HubEntry => ({
  pane: pane(id, { pinned: opts.pinned }),
  tabId, tabName, accentColor: '#123456', isActiveTab: false, busy: opts.busy ?? false,
})

describe('composeHubGroups', () => {
  it('groups entries by their source workspace, preserving first-seen order', () => {
    const entries = [
      entry('a1', 'wsA', 'API'),
      entry('b1', 'wsB', 'Web'),
      entry('a2', 'wsA', 'API'),
    ]
    const { groups } = composeHubGroups(entries, 'all', new Set())
    expect(groups.map(g => g.tabId)).toEqual(['wsA', 'wsB'])
    expect(groups[0].entries.map(e => e.pane.id)).toEqual(['a1', 'a2'])
    expect(groups[1].entries.map(e => e.pane.id)).toEqual(['b1'])
  })

  it('excludes hidden panes from a group but counts them as hiddenCount', () => {
    const entries = [
      entry('a1', 'wsA', 'API'),
      entry('a2', 'wsA', 'API'),
      entry('a3', 'wsA', 'API'),
    ]
    const { groups, shown, hidden } = composeHubGroups(entries, 'all', new Set(['a2', 'a3']))
    expect(groups[0].entries.map(e => e.pane.id)).toEqual(['a1'])
    expect(groups[0].hiddenCount).toBe(2)
    expect(shown).toBe(1)
    expect(hidden).toBe(2)
  })

  it('keeps a workspace group visible (empty) when all its terminals are hidden, so it can be re-shown', () => {
    const entries = [entry('a1', 'wsA', 'API')]
    const { groups } = composeHubGroups(entries, 'all', new Set(['a1']))
    expect(groups).toHaveLength(1)
    expect(groups[0].entries).toEqual([])
    expect(groups[0].hiddenCount).toBe(1)
  })

  it('applies the cross-cutting chip filter before grouping (active)', () => {
    const entries = [
      entry('a1', 'wsA', 'API', { busy: true }),
      entry('a2', 'wsA', 'API', { busy: false }),
    ]
    const { groups, counts } = composeHubGroups(entries, 'active', new Set())
    expect(groups[0].entries.map(e => e.pane.id)).toEqual(['a1'])
    expect(counts).toEqual({ all: 2, active: 1, pinned: 0 })
  })

  it('does not cap the number of terminals (no 12-pane limit)', () => {
    const entries = Array.from({ length: 20 }, (_, i) => entry(`p${i}`, 'wsA', 'API'))
    const { groups, shown } = composeHubGroups(entries, 'all', new Set())
    expect(groups[0].entries).toHaveLength(20)
    expect(shown).toBe(20)
  })

  it('reports counts over the full unfiltered set regardless of chip/hidden', () => {
    const entries = [
      entry('a1', 'wsA', 'API', { busy: true, pinned: true }),
      entry('a2', 'wsA', 'API', { busy: false, pinned: false }),
    ]
    const { counts } = composeHubGroups(entries, 'pinned', new Set(['a1']))
    expect(counts).toEqual({ all: 2, active: 1, pinned: 1 })
  })
})
