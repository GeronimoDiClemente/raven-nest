import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PaneDragGhost } from '../../components/PaneDragGhost'
import type { PaneNode } from '../../types'

function makePane(o: Partial<PaneNode> = {}): PaneNode {
  return {
    id: 'p1',
    aiType: 'terminal',
    accountName: 'acc',
    accountDir: '',
    borderColor: '#0055FF',
    cmd: '',
    ...o,
  }
}

// El fantasma del drag (DragOverlay) debe mostrar el CONTENIDO del pane —
// la foto capturada cuando está lista, o un label descriptivo mientras tanto —
// NUNCA un recuadro vacío. Este componente es el que faltaba en el overlay del
// Hub (mostraba un div `.hub-drag-overlay` sin contenido).
describe('PaneDragGhost', () => {
  it('muestra la foto capturada cuando hay snapshot', () => {
    const { container } = render(
      <PaneDragGhost pane={makePane({ aiType: 'browser', url: 'https://example.com' })} snapshot="data:image/png;base64,AAAA" />,
    )
    const img = container.querySelector('img.drag-overlay-snapshot')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA')
  })

  it('sin snapshot, un editor muestra el basename del archivo activo (no "Editor")', () => {
    render(
      <PaneDragGhost pane={makePane({ aiType: 'editor', activeEditorTabPath: 'src/foo.ts' })} snapshot={null} />,
    )
    expect(screen.getByText('foo.ts')).toBeInTheDocument()
    expect(document.querySelector('img.drag-overlay-snapshot')).not.toBeInTheDocument()
  })

  it('sin snapshot, un browser muestra su dominio (no "Browser")', () => {
    render(
      <PaneDragGhost pane={makePane({ aiType: 'browser', url: 'https://www.example.com/path' })} snapshot={null} />,
    )
    expect(screen.getByText('example.com')).toBeInTheDocument()
  })
})
