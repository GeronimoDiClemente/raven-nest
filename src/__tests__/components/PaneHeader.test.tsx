import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

// Recuperados: estos tres tests existian y se perdieron al reemplazar el
// archivo por los de color. La feature de rename sigue viva en PaneHeader
// (editingLabel / commitLabel con trim / prop onRename), asi que sin ellos
// una regresion en el trim o en el doble click pasaba desapercibida.
describe('PaneHeader — rename', () => {
  const aiPane = () => makePane({ aiType: 'claude', accountName: 'work', borderColor: '#8B5CF6' })

  it('muestra el label custom como texto en un pane de agente', () => {
    render(<PaneHeader {...baseProps} pane={{ ...aiPane(), customLabel: 'API server' }} onRename={() => {}} />)
    expect(screen.getByText('API server')).toBeTruthy()
  })

  it('renombra con doble click, tipeo y Enter, recortando el valor', () => {
    const onRename = vi.fn()
    render(<PaneHeader {...baseProps} pane={aiPane()} onRename={onRename} />)
    fireEvent.doubleClick(screen.getByTitle(/rename/i))
    const input = screen.getByPlaceholderText(/rename/i)
    fireEvent.change(input, { target: { value: '  DB pane  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('DB pane')
  })

  it('no ofrece rename si no le pasan onRename', () => {
    render(<PaneHeader {...baseProps} pane={aiPane()} />)
    expect(screen.queryByTitle(/rename/i)).toBeNull()
  })
})
