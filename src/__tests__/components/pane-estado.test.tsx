import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PaneHeader from '../../components/PaneHeader'
import type { PaneNode } from '../../types'

const pane = {
  id: 'p1', type: 'terminal', aiType: 'claude', borderColor: 'transparent',
} as unknown as PaneNode

const base = {
  pane, zoomed: false, onZoom: vi.fn(), onClose: vi.fn(),
  onColorChange: vi.fn(), onNoteChange: vi.fn(),
}

/**
 * El chip de estado: el dato que faltaba. El header sabia que hubo salida (un punto) y que
 * el proceso murio ("ended"). Con ocho panes abiertos eso no contesta la pregunta que
 * importa —cual me necesita— y las tres situaciones se veian iguales.
 */
describe('el chip de estado del pane', () => {
  it('quieto y visto no muestra nada', () => {
    render(<PaneHeader {...base} estado="idle" />)
    expect(screen.queryByTestId('pane-estado')).toBeNull()
  })

  it('cuando te necesita lo dice, en ingles', () => {
    render(<PaneHeader {...base} estado="waiting" />)
    expect(screen.getByTestId('pane-estado')).toHaveTextContent('needs you')
  })

  it('sin leer y trabajando tienen su propia etiqueta', () => {
    const { unmount } = render(<PaneHeader {...base} estado="unread" />)
    expect(screen.getByTestId('pane-estado')).toHaveTextContent('unread')
    unmount()
    render(<PaneHeader {...base} estado="working" />)
    expect(screen.getByTestId('pane-estado')).toHaveTextContent('working')
  })

  /**
   * El titulo dice que `waiting` es una LECTURA de la salida y no un hecho del sistema. Si el
   * usuario ve "needs you" y el agente estaba trabajando, tiene que poder entender por que nos
   * equivocamos en vez de dejar de creerle al indicador para siempre.
   */
  it('explica de donde sale la conclusion', () => {
    render(<PaneHeader {...base} estado="waiting" />)
    expect(screen.getByTestId('pane-estado').getAttribute('title')).toMatch(/looks like a question/i)
  })

  // Un proceso muerto no esta trabajando ni esperando nada.
  it('un proceso terminado gana sobre cualquier estado', () => {
    render(<PaneHeader {...base} estado="waiting" processEnded />)
    expect(screen.queryByTestId('pane-estado')).toBeNull()
    expect(screen.getByText('ended')).toBeInTheDocument()
  })
})
