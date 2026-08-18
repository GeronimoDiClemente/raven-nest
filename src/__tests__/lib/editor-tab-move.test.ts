import { describe, it, expect } from 'vitest'
import { moveTabBetweenPanes, openFileInPane } from '../../lib/editor-tab-move'
import type { PaneNode } from '../../types'

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
