import { describe, it, expect } from 'vitest'
import { moveTabBetweenPanes, moveTabAcrossWorkspaces, openFileInPane, splitEditorTabFromHub } from '../../lib/editor-tab-move'
import type { PaneNode, WorkspaceTab } from '../../types'

function editorPane(id: string, tabs: Array<{ relPath: string; dirty: boolean }>, active?: string, repoPath = '/wt'): PaneNode {
  return {
    id, aiType: 'editor', accountName: '', accountDir: '', borderColor: '', cmd: '',
    repoPath, editorTabs: tabs, activeEditorTabPath: active ?? tabs[0]?.relPath,
  }
}

describe('moveTabBetweenPanes (drag & drop de tabs)', () => {
  it('moves the tab with its dirty flag and activates it in the destination', () => {
    const panes = [
      editorPane('src', [{ relPath: 'a.ts', dirty: true }, { relPath: 'b.ts', dirty: false }]),
      editorPane('dst', [{ relPath: 'c.ts', dirty: false }]),
    ]
    const res = moveTabBetweenPanes(panes, 'src', 'dst', 'a.ts', true)
    expect(res).not.toBeNull()
    const src = res!.panes.find(p => p.id === 'src')!
    const dst = res!.panes.find(p => p.id === 'dst')!
    expect(src.editorTabs).toEqual([{ relPath: 'b.ts', dirty: false }])
    expect(src.activeEditorTabPath).toBe('b.ts')
    expect(dst.editorTabs).toEqual([{ relPath: 'c.ts', dirty: false }, { relPath: 'a.ts', dirty: true }])
    expect(dst.activeEditorTabPath).toBe('a.ts')
    expect(res!.dropStash).toBe(false)
  })

  it('removes the source pane when the moved tab was its last one', () => {
    const panes = [
      editorPane('src', [{ relPath: 'a.ts', dirty: false }]),
      editorPane('dst', [{ relPath: 'c.ts', dirty: false }]),
    ]
    const res = moveTabBetweenPanes(panes, 'src', 'dst', 'a.ts', false)
    expect(res!.panes.map(p => p.id)).toEqual(['dst'])
  })

  it('merges into an existing clean copy in the destination (and asks to drop the stash)', () => {
    const panes = [
      editorPane('src', [{ relPath: 'a.ts', dirty: false }, { relPath: 'b.ts', dirty: false }]),
      editorPane('dst', [{ relPath: 'a.ts', dirty: false }]),
    ]
    const res = moveTabBetweenPanes(panes, 'src', 'dst', 'a.ts', false)
    const src = res!.panes.find(p => p.id === 'src')!
    const dst = res!.panes.find(p => p.id === 'dst')!
    expect(src.editorTabs).toEqual([{ relPath: 'b.ts', dirty: false }])
    expect(dst.editorTabs).toEqual([{ relPath: 'a.ts', dirty: false }])
    expect(dst.activeEditorTabPath).toBe('a.ts')
    expect(res!.dropStash).toBe(true)
  })

  it('keeps BOTH tabs when the moved tab is dirty and the destination already has the file', () => {
    // Dos buffers divergentes del mismo archivo: fusionar descartaría uno.
    // Se activa la copia del destino y la tab origen se queda donde estaba.
    const panes = [
      editorPane('src', [{ relPath: 'a.ts', dirty: true }, { relPath: 'b.ts', dirty: false }]),
      editorPane('dst', [{ relPath: 'a.ts', dirty: false }]),
    ]
    const res = moveTabBetweenPanes(panes, 'src', 'dst', 'a.ts', true)
    const src = res!.panes.find(p => p.id === 'src')!
    expect(src.editorTabs).toHaveLength(2)
    expect(res!.panes.find(p => p.id === 'dst')!.activeEditorTabPath).toBe('a.ts')
  })

  it('rejects a cross-worktree drop (relPath means another file there)', () => {
    const panes = [
      editorPane('src', [{ relPath: 'a.ts', dirty: false }, { relPath: 'b.ts', dirty: false }], 'a.ts', '/wt-1'),
      editorPane('dst', [{ relPath: 'c.ts', dirty: false }], 'c.ts', '/wt-2'),
    ]
    expect(moveTabBetweenPanes(panes, 'src', 'dst', 'a.ts', false)).toBeNull()
  })

  it('no-ops on same pane, unknown panes and non-editor panes', () => {
    const term: PaneNode = { id: 't', aiType: 'claude', accountName: '', accountDir: '', borderColor: '', cmd: '' }
    const panes = [editorPane('src', [{ relPath: 'a.ts', dirty: false }, { relPath: 'b.ts', dirty: false }]), term]
    expect(moveTabBetweenPanes(panes, 'src', 'src', 'a.ts', false)).toBeNull()
    expect(moveTabBetweenPanes(panes, 'src', 'nope', 'a.ts', false)).toBeNull()
    expect(moveTabBetweenPanes(panes, 'src', 't', 'a.ts', false)).toBeNull()
  })
})

describe('moveTabAcrossWorkspaces (DnD en el Hub: panes de workspaces distintos)', () => {
  function makeWorkspaces(): WorkspaceTab[] {
    return [
      { id: 'ws-1', name: 'W1', layoutId: '1', panes: [editorPane('e1', [{ relPath: 'a.ts', dirty: true }])] },
      { id: 'ws-2', name: 'W2', layoutId: '1', panes: [editorPane('e2', [{ relPath: 'c.ts', dirty: false }])] },
      { id: 'hub', name: 'Hub', layoutId: '1', isHub: true, panes: [], hubPanes: ['e1', 'e2'] },
    ] as unknown as WorkspaceTab[]
  }

  it('moves a tab between panes of DIFFERENT workspaces (same worktree)', () => {
    const res = moveTabAcrossWorkspaces(makeWorkspaces(), 'e1', 'e2', 'a.ts', true)
    expect(res).not.toBeNull()
    const ws1 = res!.tabs.find(t => t.id === 'ws-1')!
    const ws2 = res!.tabs.find(t => t.id === 'ws-2')!
    const hub = res!.tabs.find(t => t.id === 'hub')!
    expect(ws1.panes).toHaveLength(0) // el pane origen quedó vacío y se fue
    expect(ws2.panes[0].editorTabs).toEqual([{ relPath: 'c.ts', dirty: false }, { relPath: 'a.ts', dirty: true }])
    expect(ws2.panes[0].activeEditorTabPath).toBe('a.ts')
    expect(hub.hubPanes).toEqual(['e2']) // el pane removido sale del Hub
  })

  it('still handles both panes in the SAME workspace', () => {
    const tabs = [
      { id: 'ws-1', name: 'W1', layoutId: '2V', panes: [
        editorPane('e1', [{ relPath: 'a.ts', dirty: false }, { relPath: 'b.ts', dirty: false }]),
        editorPane('e2', [{ relPath: 'c.ts', dirty: false }]),
      ] },
    ] as unknown as WorkspaceTab[]
    const res = moveTabAcrossWorkspaces(tabs, 'e1', 'e2', 'a.ts', false)
    const ws = res!.tabs[0]
    expect(ws.panes.find(p => p.id === 'e1')!.editorTabs).toEqual([{ relPath: 'b.ts', dirty: false }])
    expect(ws.panes.find(p => p.id === 'e2')!.activeEditorTabPath).toBe('a.ts')
  })

  it('rejects cross-worktree moves', () => {
    const tabs = makeWorkspaces()
    ;(tabs[1].panes[0] as PaneNode).repoPath = '/otro-wt'
    expect(moveTabAcrossWorkspaces(tabs, 'e1', 'e2', 'a.ts', true)).toBeNull()
  })

  it('keeps both tabs when the incoming one is dirty and the destination already has the file', () => {
    const tabs = makeWorkspaces()
    ;(tabs[1].panes[0] as PaneNode).editorTabs = [{ relPath: 'a.ts', dirty: false }]
    const res = moveTabAcrossWorkspaces(tabs, 'e1', 'e2', 'a.ts', true)
    expect(res!.tabs.find(t => t.id === 'ws-1')!.panes[0].editorTabs).toHaveLength(1) // origen intacto
    expect(res!.tabs.find(t => t.id === 'ws-2')!.panes[0].activeEditorTabPath).toBe('a.ts')
  })
})

describe('splitEditorTabFromHub (Open in new pane desde el Hub)', () => {
  function makeTabs(): WorkspaceTab[] {
    return [
      {
        id: 'ws-1', name: 'Workspace', layoutId: '1',
        panes: [editorPane('e1', [{ relPath: 'a.ts', dirty: true }, { relPath: 'b.ts', dirty: false }])],
      },
      { id: 'hub', name: 'Hub', layoutId: '1', isHub: true, panes: [], hubPanes: ['e1'] },
    ] as unknown as WorkspaceTab[]
  }

  it('creates the split pane in the SOURCE workspace and pins it to the hub', () => {
    const res = splitEditorTabFromHub(makeTabs(), 'hub', 'e1', 'a.ts', 'nuevo-pane')
    expect(res).not.toBeNull()
    const ws = res!.find(t => t.id === 'ws-1')!
    const hub = res!.find(t => t.id === 'hub')!
    expect(ws.panes.map(p => p.id)).toEqual(['e1', 'nuevo-pane'])
    const nuevo = ws.panes.find(p => p.id === 'nuevo-pane')!
    expect(nuevo.aiType).toBe('editor')
    expect(nuevo.editorTabs).toEqual([{ relPath: 'a.ts', dirty: true }]) // el dirty viaja
    expect(nuevo.repoPath).toBe('/wt')
    expect(ws.panes.find(p => p.id === 'e1')!.editorTabs).toEqual([{ relPath: 'b.ts', dirty: false }])
    expect(hub.hubPanes).toEqual(['e1', 'nuevo-pane']) // pinneado: visible donde estás
  })

  it('no-ops when the tab is the pane only tab', () => {
    const tabs = makeTabs()
    ;(tabs[0].panes[0] as PaneNode).editorTabs = [{ relPath: 'a.ts', dirty: false }]
    expect(splitEditorTabFromHub(tabs, 'hub', 'e1', 'a.ts', 'x')).toBeNull()
  })

  it('no-ops when the source pane is not found in any workspace', () => {
    expect(splitEditorTabFromHub(makeTabs(), 'hub', 'fantasma', 'a.ts', 'x')).toBeNull()
  })
})

describe('openFileInPane (drop de archivo del Explorer)', () => {
  it('opens the file as a new active tab in the target pane', () => {
    const panes = [editorPane('e1', [{ relPath: 'a.ts', dirty: false }])]
    const next = openFileInPane(panes, 'e1', 'src/nuevo.ts')
    expect(next.find(p => p.id === 'e1')!.editorTabs).toEqual([
      { relPath: 'a.ts', dirty: false }, { relPath: 'src/nuevo.ts', dirty: false },
    ])
    expect(next.find(p => p.id === 'e1')!.activeEditorTabPath).toBe('src/nuevo.ts')
  })

  it('just activates the tab when the file is already open there', () => {
    const panes = [editorPane('e1', [{ relPath: 'a.ts', dirty: true }, { relPath: 'b.ts', dirty: false }], 'b.ts')]
    const next = openFileInPane(panes, 'e1', 'a.ts')
    expect(next.find(p => p.id === 'e1')!.editorTabs).toHaveLength(2)
    expect(next.find(p => p.id === 'e1')!.activeEditorTabPath).toBe('a.ts')
  })

  it('leaves non-editor panes untouched', () => {
    const term: PaneNode = { id: 't', aiType: 'claude', accountName: '', accountDir: '', borderColor: '', cmd: '' }
    expect(openFileInPane([term], 't', 'a.ts')).toEqual([term])
  })
})
