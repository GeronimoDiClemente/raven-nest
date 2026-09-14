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

/**
 * El color dejo de ser un circulo aparte: ahora es el ANILLO del logo del agente.
 *
 * Eran dos elementos peleando por el primer lugar del header, y lo primero que veias de un
 * pane no era QUE agente es sino de que color lo pintaste. Encima, con el borde apagado el
 * circulo quedaba vacio — que se lee como algo que no cargo, no como "sin color".
 */
describe('PaneHeader — identidad y color', () => {
  it('el color del pane es el anillo del boton de identidad', () => {
    const { container } = render(<PaneHeader pane={makePane({ borderColor: '#0055FF' })} {...baseProps} />)
    const btn = container.querySelector('.pane-identidad-btn') as HTMLElement | null
    expect(btn).toBeInTheDocument()
    expect(btn?.style.getPropertyValue('--anillo')).toBe('#0055FF')
    expect(btn?.className).not.toContain('sin-color')
  })

  it('sin color no finge uno: queda el aro tenue y ningun texto', () => {
    const { container } = render(<PaneHeader pane={makePane({ borderColor: 'transparent' })} {...baseProps} />)
    const btn = container.querySelector('.pane-identidad-btn') as HTMLElement | null
    expect(btn?.className).toContain('sin-color')
    expect(btn?.style.getPropertyValue('--anillo')).toBe('')
  })

  // Lo que el usuario pidio: el agente primero, no el color.
  it('el logo del agente es lo primero del header', () => {
    const { container } = render(<PaneHeader pane={makePane({ borderColor: '#0055FF' })} {...baseProps} />)
    const primero = container.querySelector('.pane-header-left')?.firstElementChild
    expect(primero?.className).toContain('pane-identidad')
  })

  it('el circulo de color suelto ya no existe', () => {
    const { container } = render(<PaneHeader pane={makePane({ borderColor: '#0055FF' })} {...baseProps} />)
    expect(container.querySelector('.pane-color-btn')).toBeNull()
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
