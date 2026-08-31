import { describe, it, expect } from 'vitest'
import { collectDragCaptures } from '../../layout/dragCaptures'
import type { PaneNode } from '../../types'

function pane(id: string, aiType: PaneNode['aiType']): PaneNode {
  return { id, aiType, accountName: '', accountDir: '', borderColor: '#888', cmd: '' }
}

describe('collectDragCaptures — qué panes capturar al empezar el drag', () => {
  it('captura TODOS los browser, para el freeze-frame en su lugar', () => {
    const panes = [pane('t1', 'terminal'), pane('b1', 'browser'), pane('e1', 'editor'), pane('b2', 'browser')]
    expect(collectDragCaptures(panes, 't1')).toEqual([
      { paneId: 'b1', kind: 'browser' },
      { paneId: 'b2', kind: 'browser' },
    ])
  })

  it('si el arrastrado ES un browser, no lo duplica', () => {
    const panes = [pane('b1', 'browser'), pane('e1', 'editor')]
    expect(collectDragCaptures(panes, 'b1')).toEqual([
      { paneId: 'b1', kind: 'browser' },
    ])
  })

  // Antes se fotografiaba tambien el pane arrastrado (kind 'dom') para el
  // fantasma. No servia: cuando la captura corria, React ya habia pintado el
  // DragOverlay encima del pane origen, asi que la "foto" era el propio
  // fantasma opaco — un rectangulo gris. El ghost con etiqueta lo reemplaza.
  it('no fotografia el pane arrastrado cuando no es browser', () => {
    const panes = [pane('e1', 'editor'), pane('t1', 'terminal')]
    expect(collectDragCaptures(panes, 'e1')).toEqual([])
  })

  it('sin browsers no hay nada que capturar', () => {
    const panes = [pane('t1', 'terminal'), pane('t2', 'terminal')]
    expect(collectDragCaptures(panes, 't1')).toEqual([])
  })

  it('draggingId inexistente → solo los browsers', () => {
    const panes = [pane('b1', 'browser')]
    expect(collectDragCaptures(panes, 'zzz')).toEqual([
      { paneId: 'b1', kind: 'browser' },
    ])
  })
})
