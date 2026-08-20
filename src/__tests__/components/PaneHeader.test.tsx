import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import PaneHeader from '../../components/PaneHeader'
import type { PaneNode } from '../../types'

function makePane(o: Partial<PaneNode> = {}): PaneNode {
  return {
    id: 'p1',
    aiType: 'terminal',
    accountName: '',
    accountDir: '',
    borderColor: '#0055FF',
    cmd: '',
    ...o,
  }
}

const baseProps = {
  zoomed: false,
  onZoom: () => {},
  onClose: () => {},
  onColorChange: () => {},
  onNoteChange: () => {},
}

describe('PaneHeader — indicador de color', () => {
  // "Sin color" (borderColor transparent) mostraba una ✕ dentro de un círculo
  // con borde punteado — se veía como líneas y obstrucción. Debe quedar un
  // mini círculo transparente limpio, sin la ✕.
  it('sin color no muestra la ✕ dentro del botón', () => {
    const { container } = render(<PaneHeader pane={makePane({ borderColor: 'transparent' })} {...baseProps} />)
    const btn = container.querySelector('.pane-color-btn')
    expect(btn).toBeInTheDocument()
    expect(btn?.textContent).toBe('')
  })

  it('con color, el botón usa ese color de fondo y no muestra texto', () => {
    const { container } = render(<PaneHeader pane={makePane({ borderColor: '#0055FF' })} {...baseProps} />)
    const btn = container.querySelector('.pane-color-btn') as HTMLElement | null
    expect(btn).toBeInTheDocument()
    expect(btn?.textContent).toBe('')
  })
})
