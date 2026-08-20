import { describe, it, expect } from 'vitest'
import { collectDragCaptures } from '../../layout/dragCaptures'
import type { PaneNode } from '../../types'

function pane(id: string, aiType: PaneNode['aiType']): PaneNode {
  return { id, aiType, accountName: '', accountDir: '', borderColor: '#888', cmd: '' }
}

describe('collectDragCaptures — qué panes capturar al empezar el drag', () => {
  it('captura TODOS los browser (freeze-frame) + el pane arrastrado (fantasma)', () => {
    const panes = [pane('t1', 'terminal'), pane('b1', 'browser'), pane('e1', 'editor'), pane('b2', 'browser')]
    // arrastrando el terminal t1
    expect(collectDragCaptures(panes, 't1')).toEqual([
      { paneId: 'b1', kind: 'browser' },
      { paneId: 'b2', kind: 'browser' },
      { paneId: 't1', kind: 'dom' },
    ])
  })

  it('si el arrastrado ES un browser, no lo duplica ni le agrega un dom', () => {
    const panes = [pane('b1', 'browser'), pane('e1', 'editor')]
    expect(collectDragCaptures(panes, 'b1')).toEqual([
      { paneId: 'b1', kind: 'browser' },
    ])
  })

  it('sin browsers, arrastrando un editor → solo el dom del arrastrado', () => {
    const panes = [pane('e1', 'editor'), pane('t1', 'terminal')]
    expect(collectDragCaptures(panes, 'e1')).toEqual([
      { paneId: 'e1', kind: 'dom' },
    ])
  })

  it('draggingId inexistente → solo los browsers, sin dom colgante', () => {
    const panes = [pane('b1', 'browser')]
    expect(collectDragCaptures(panes, 'zzz')).toEqual([
      { paneId: 'b1', kind: 'browser' },
    ])
  })
})
