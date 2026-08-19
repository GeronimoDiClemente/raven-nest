import { describe, it, expect } from 'vitest'
import { openFileFromHub } from '../../lib/hub-open-file'
import { defaultLayoutFor } from '../../layout/select'
import type { PaneNode, WorkspaceTab } from '../../types'

// Minimal pane; only the fields the helper reads/writes.
const pane = (id: string, extra: Partial<PaneNode> = {}): PaneNode => ({
  id, aiType: 'terminal', accountName: '', accountDir: '', borderColor: '#888', cmd: '', ...extra,
})

const editorPane = (id: string, repoPath: string, relPaths: string[]): PaneNode =>
  pane(id, {
    aiType: 'editor',
    repoPath,
    editorTabs: relPaths.map(relPath => ({ relPath, dirty: false })),
    activeEditorTabPath: relPaths[relPaths.length - 1],
  })

const hubTab = (hubPanes: string[]): WorkspaceTab =>
  ({ id: 'hub', name: 'Hub', layoutId: '1', panes: [], isHub: true, hubPanes })

const wsTab = (panes: PaneNode[], extra: Partial<WorkspaceTab> = {}): WorkspaceTab =>
  ({ id: 'ws1', name: 'API', layoutId: '1', panes, ...extra })

describe('openFileFromHub', () => {
  it('creates a new editor pane in the owning workspace and pins it to the Hub', () => {
    const tabs = [hubTab([]), wsTab([pane('term1')])]
    const fresh = editorPane('ed-new', '/repo', ['src/a.ts'])

    const { tabs: next, paneId } = openFileFromHub(tabs, 'hub', 'ws1', '/repo', 'src/a.ts', fresh)

    const ws = next.find(t => t.id === 'ws1')!
    expect(ws.panes.map(p => p.id)).toEqual(['term1', 'ed-new'])
    const ed = ws.panes.find(p => p.id === 'ed-new')!
    expect(ed.activeEditorTabPath).toBe('src/a.ts')
    expect(next.find(t => t.id === 'hub')!.hubPanes).toContain('ed-new')
    expect(paneId).toBe('ed-new')
  })

  it('reuses an existing editor pane of the same worktree, appending the file as a tab', () => {
    const existing = editorPane('ed1', '/repo', ['src/x.ts'])
    const tabs = [hubTab([]), wsTab([existing])]
    const fresh = editorPane('ed-new', '/repo', ['src/y.ts'])

    const { tabs: next, paneId } = openFileFromHub(tabs, 'hub', 'ws1', '/repo', 'src/y.ts', fresh)

    const ws = next.find(t => t.id === 'ws1')!
    expect(ws.panes.map(p => p.id)).toEqual(['ed1'])   // no new pane created
    const ed = ws.panes.find(p => p.id === 'ed1')!
    expect(ed.editorTabs!.map(t => t.relPath)).toEqual(['src/x.ts', 'src/y.ts'])
    expect(ed.activeEditorTabPath).toBe('src/y.ts')
    expect(paneId).toBe('ed1')
    expect(next.find(t => t.id === 'hub')!.hubPanes).toEqual(['ed1'])
  })

  it('is idempotent: an already-open, already-pinned file adds no duplicates', () => {
    const existing = editorPane('ed1', '/repo', ['src/x.ts'])
    const tabs = [hubTab(['ed1']), wsTab([existing])]
    const fresh = editorPane('ed-new', '/repo', ['src/x.ts'])

    const { tabs: next } = openFileFromHub(tabs, 'hub', 'ws1', '/repo', 'src/x.ts', fresh)

    const ed = next.find(t => t.id === 'ws1')!.panes.find(p => p.id === 'ed1')!
    expect(ed.editorTabs!.map(t => t.relPath)).toEqual(['src/x.ts'])
    expect(next.find(t => t.id === 'hub')!.hubPanes).toEqual(['ed1'])
  })

  it('matches the worktree canonically (slash form), not by raw string equality', () => {
    const existing = editorPane('ed1', 'C:/repo', ['src/x.ts'])
    const tabs = [hubTab([]), wsTab([existing])]
    const fresh = editorPane('ed-new', 'C:\\repo', ['src/y.ts'])

    const { tabs: next, paneId } = openFileFromHub(tabs, 'hub', 'ws1', 'C:\\repo', 'src/y.ts', fresh)

    expect(paneId).toBe('ed1')   // reused despite C:/ vs C:\
    expect(next.find(t => t.id === 'ws1')!.panes.map(p => p.id)).toEqual(['ed1'])
  })

  it('promotes the workspace layout when the created pane overflows the current preset', () => {
    const tabs = [hubTab([]), wsTab([pane('term1')], { layoutId: '1', splitRatios: { root: [50, 50] } })]
    const fresh = editorPane('ed-new', '/repo', ['src/a.ts'])

    const { tabs: next } = openFileFromHub(tabs, 'hub', 'ws1', '/repo', 'src/a.ts', fresh)

    const ws = next.find(t => t.id === 'ws1')!
    expect(ws.layoutId).toBe(defaultLayoutFor(2))
    expect(ws.splitRatios).toEqual({})
  })
})
