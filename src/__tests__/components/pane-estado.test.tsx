import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

  /**
   * `working` y `unread` se calculan pero NO se dibujan.
   *
   * `working` estaria prendido en toda terminal activa todo el tiempo: un indicador que
   * siempre esta encendido no informa, es ruido con forma de dato. Y `unread` etiqueta algo
   * que ya se nota, poniendole un color a cada pane del que te alejaste.
   */
  it('trabajando y sin leer no dibujan nada', () => {
    const { unmount } = render(<PaneHeader {...base} estado="working" />)
    expect(screen.queryByTestId('pane-estado')).toBeNull()
    unmount()
    render(<PaneHeader {...base} estado="unread" />)
    expect(screen.queryByTestId('pane-estado')).toBeNull()
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

/**
 * El selector de color del pane.
 *
 * Los doce colores del tema son SEIS TONOS Y SUS BRILLANTES. Con la ✕ de apagar ocupando el
 * primer casillero quedaban trece elementos en una grilla de seis columnas —6, 6 y uno
 * colgando— y ese corte partía los pares al medio: lo que se veía era una lista desordenada
 * con colores repetidos en vez de dos filas de seis.
 */
describe('el selector de color', () => {
  const tema = {
    id: 't', nombre: 'T', background: '#000', foreground: '#fff', cursor: '#fff',
    selection: '#333',
    ansi: ['#000000','#aa0000','#00aa00','#aaaa00','#0000aa','#aa00aa','#00aaaa','#cccccc',
           '#555555','#ff0000','#00ff00','#ffff00','#0000ff','#ff00ff','#00ffff','#ffffff'],
  }

  const abrirSelector = (extra = {}) => {
    render(<PaneHeader {...base} temaDeTerminal={tema} {...extra} />)
    fireEvent.click(screen.getByTitle(/Change border color|Border off/))
  }

  it('los doce del tema caen en la grilla, y apagar queda afuera', () => {
    abrirSelector()
    const grilla = document.querySelector('.pane-color-grid')
    expect(grilla, 'la grilla existe').not.toBeNull()
    expect(grilla!.querySelectorAll('button')).toHaveLength(12)
    // Apagar es hermano de la grilla, no un casillero mas.
    expect(grilla!.querySelector('.pane-color-off')).toBeNull()
    expect(document.querySelector('.pane-color-off')).not.toBeNull()
  })

  // Con dos tonos casi iguales, saber cual es cual es la diferencia entre doce opciones y
  // seis que parecen repetidas.
  it('cada muestra dice qué color es', () => {
    abrirSelector()
    expect(screen.getByTitle('red')).toBeInTheDocument()
    expect(screen.getByTitle('bright red')).toBeInTheDocument()
    expect(screen.getByTitle('bright cyan')).toBeInTheDocument()
  })

  it('apagar el borde es una acción con nombre, no una ✕ suelta', () => {
    abrirSelector()
    expect(screen.getByRole('button', { name: 'No border' })).toBeInTheDocument()
  })

  it('elegir un color guarda el índice del tema, no el hex', () => {
    const onColorChange = vi.fn()
    abrirSelector({ onColorChange })
    fireEvent.click(screen.getByTitle('bright green'))
    expect(onColorChange).toHaveBeenCalledWith('ansi:10')
  })
})

/**
 * Color libre, ademas de los del tema.
 *
 * La grilla del tema es el atajo: colores que ya armonizan y que siguen al tema si lo
 * cambias. Pero acotar la eleccion a esa paleta era una decision nuestra sobre algo que es
 * del usuario — el borde de un pane es una etiqueta que pone el, no una parte del tema.
 */
describe('el color libre', () => {
  const tema = {
    id: 't', nombre: 'T', background: '#000', foreground: '#fff', cursor: '#fff', selection: '#333',
    ansi: ['#000000','#aa0000','#00aa00','#aaaa00','#0000aa','#aa00aa','#00aaaa','#cccccc',
           '#555555','#ff0000','#00ff00','#ffff00','#0000ff','#ff00ff','#00ffff','#ffffff'],
  }
  const abrir = (extra = {}) => {
    render(<PaneHeader {...base} temaDeTerminal={tema} {...extra} />)
    fireEvent.click(screen.getByTitle(/Change border color|Border off/))
  }

  it('hay un selector libre además de la paleta', () => {
    abrir()
    expect(screen.getByLabelText('Custom colour')).toBeInTheDocument()
    expect(document.querySelectorAll('.pane-color-grid button')).toHaveLength(12)
  })

  // Un color propio se guarda como HEX y no como índice: los del tema se guardan por índice
  // justamente para poder seguirlo, y un color tuyo no tiene a qué seguir.
  it('un color propio se guarda como hex', () => {
    const onColorChange = vi.fn()
    abrir({ onColorChange })
    fireEvent.change(screen.getByLabelText('Custom colour'), { target: { value: '#ff8800' } })
    expect(onColorChange).toHaveBeenCalledWith('#ff8800')
  })

  it('el selector libre arranca mostrando el color actual del pane', () => {
    abrir({ pane: { ...pane, borderColor: '#123456' } })
    expect((screen.getByLabelText('Custom colour') as HTMLInputElement).value).toBe('#123456')
  })

  // Sin color, el input tiene que mostrar ALGO: `transparent` no es un valor válido para
  // `type="color"` y el navegador cae a negro sin avisar.
  it('sin color elegido no le pasa un valor inválido al input', () => {
    abrir({ pane: { ...pane, borderColor: 'transparent' } })
    expect((screen.getByLabelText('Custom colour') as HTMLInputElement).value).toMatch(/^#[0-9a-f]{6}$/)
  })
})
