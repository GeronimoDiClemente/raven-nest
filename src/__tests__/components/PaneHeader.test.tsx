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

describe('PaneHeader — borde del header al apagar el color', () => {
  // Bug reportado: al pasar de un color a "sin color" quedaba una línea del
  // color anterior (naranja con Claude). Causa: el estilo inline concatenaba
  // el alpha al color (`${borderColor}44`), y con 'transparent' generaba
  // `1px solid transparent44` — inválido. El CSSOM descarta la asignación
  // inválida y CONSERVA el valor previo, así que el color viejo quedaba pegado.
  it('apagar el color no deja pegado el color anterior', () => {
    const { container, rerender } = render(
      <PaneHeader pane={makePane({ borderColor: '#E07B54' })} {...baseProps} />
    )
    const header = container.querySelector('.pane-header') as HTMLElement

    rerender(<PaneHeader pane={makePane({ borderColor: 'transparent' })} {...baseProps} />)

    const style = header.getAttribute('style') ?? ''
    expect(style).not.toMatch(/E07B54|224,\s*123,\s*84/i)
  })

  it('nunca genera un color CSS inválido por concatenar el alpha', () => {
    const { container } = render(
      <PaneHeader pane={makePane({ borderColor: 'transparent' })} {...baseProps} />
    )
    const style = container.querySelector('.pane-header')?.getAttribute('style') ?? ''
    expect(style).not.toContain('transparent44')
  })
})
