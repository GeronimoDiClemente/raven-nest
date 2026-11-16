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
  // El circulo de color se ve ENTERO, no como un aro fino. Una version intermedia lo
  // convirtio en el borde de 2px del logo: quedaba ordenado y perdia justo lo que sirve, que
  // es ver el color de lejos con ocho paneles abiertos.
  it('el color se ve lleno, no como un aro', () => {
    const { container } = render(<PaneHeader pane={makePane({ borderColor: '#0055FF' })} {...baseProps} />)
    const btn = container.querySelector('.pane-color-btn') as HTMLElement | null
    expect(btn).toBeInTheDocument()
    expect(btn?.style.background).toBe('rgb(0, 85, 255)')
  })

  it('sin color el boton no finge uno', () => {
    const { container } = render(<PaneHeader pane={makePane({ borderColor: 'transparent' })} {...baseProps} />)
    const btn = container.querySelector('.pane-color-btn') as HTMLElement | null
    expect(btn?.className).toContain('off')
    expect(btn?.style.background).toBe('')
  })

  // El orden es el de siempre: el circulo de color primero y el logo adentro de la etiqueta.
  // Se probo moverlo y no mejoraba nada — lo que se perdia era ver el color de un vistazo.
  it('el circulo de color abre el header', () => {
    const { container } = render(<PaneHeader pane={makePane({ borderColor: '#0055FF' })} {...baseProps} />)
    const hijos = Array.from(container.querySelector('.pane-header-left')?.children ?? [])
    expect(hijos[0]?.className).toContain('pane-color-btn-wrap')
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

/**
 * `pane.borderColor` dejo de ser siempre un hex: desde que el selector guarda el indice del
 * tema (`ansi:5`), usarlo crudo como valor CSS no pinta NADA — el navegador descarta la
 * declaracion invalida en silencio. El disco quedaba invisible y el borde sin color.
 */
describe('PaneHeader — el color guardado como índice del tema', () => {
  const tema = {
    id: 't', nombre: 'T', background: '#000', foreground: '#fff', cursor: '#fff', selection: '#333',
    ansi: ['#000000','#aa0000','#00aa00','#aaaa00','#0000aa','#aa00aa','#00aaaa','#cccccc',
           '#555555','#ff0000','#00ff00','#ffff00','#0000ff','#ff00ff','#00ffff','#ffffff'],
  }

  it('un `ansi:N` se resuelve al color del tema, no se usa crudo', () => {
    const { container } = render(
      <PaneHeader pane={makePane({ borderColor: 'ansi:5' })} temaDeTerminal={tema} {...baseProps} />,
    )
    const btn = container.querySelector('.pane-color-btn') as HTMLElement | null
    expect(btn?.style.background, 'el disco quedó invisible: se usó el valor crudo').toBe('rgb(170, 0, 170)')
    expect(btn?.className).not.toContain('off')
  })

  it('un hex de siempre sigue andando', () => {
    const { container } = render(
      <PaneHeader pane={makePane({ borderColor: '#0055FF' })} temaDeTerminal={tema} {...baseProps} />,
    )
    expect((container.querySelector('.pane-color-btn') as HTMLElement).style.background).toBe('rgb(0, 85, 255)')
  })

  // Sin tema (callers y tests viejos) cae al propio, no a un borde sin pintar.
  it('sin tema, un índice igual resuelve contra el tema propio', () => {
    const { container } = render(
      <PaneHeader pane={makePane({ borderColor: 'ansi:1' })} {...baseProps} />,
    )
    const btn = container.querySelector('.pane-color-btn') as HTMLElement | null
    expect(btn?.className).not.toContain('off')
    expect(btn?.style.background).not.toBe('')
  })
})
