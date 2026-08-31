import { describe, it, expect } from 'vitest'
import { pruneHubPanes } from '../../lib/hub-panes'
import type { PaneNode, WorkspaceTab } from '../../types'

const pane = (id: string): PaneNode =>
  ({ id, aiType: 'terminal', accountName: '', accountDir: '', borderColor: '#888', cmd: '' })

const hubTab = (hubPanes: string[]): WorkspaceTab =>
  ({ id: 'hub', name: 'Hub', layoutId: '1', panes: [], isHub: true, hubPanes })

const wsTab = (id: string, paneIds: string[]): WorkspaceTab =>
  ({ id, name: id, layoutId: '1', panes: paneIds.map(pane) })

describe('pruneHubPanes', () => {
  it('removes a pruned pane id from every Hub tab hubPanes', () => {
    const tabs = [hubTab(['ed1', 'term2']), wsTab('ws1', ['ed1'])]
    const next = pruneHubPanes(tabs, new Set(['ed1']))
    expect(next.find(t => t.id === 'hub')!.hubPanes).toEqual(['term2'])
  })

  it('leaves non-Hub tabs untouched', () => {
    const ws = wsTab('ws1', ['ed1'])
    const tabs = [hubTab(['ed1']), ws]
    const next = pruneHubPanes(tabs, new Set(['ed1']))
    expect(next.find(t => t.id === 'ws1')).toBe(ws)   // misma referencia
  })

  it('is a no-op (same references) when no id is pinned', () => {
    const tabs = [hubTab(['other']), wsTab('ws1', ['ed1'])]
    const next = pruneHubPanes(tabs, new Set(['ed1']))
    expect(next[0]).toBe(tabs[0])   // el Hub no cambió
  })

  it('returns the same array when removed is empty', () => {
    const tabs = [hubTab(['ed1'])]
    expect(pruneHubPanes(tabs, new Set())).toBe(tabs)
  })

  it('prunes multiple ids across multiple Hub tabs', () => {
    const tabs = [hubTab(['a', 'b', 'c']), { ...hubTab(['b', 'd']), id: 'hub2' }]
    const next = pruneHubPanes(tabs, new Set(['b', 'c']))
    expect(next[0].hubPanes).toEqual(['a'])
    expect(next[1].hubPanes).toEqual(['d'])
  })
})
