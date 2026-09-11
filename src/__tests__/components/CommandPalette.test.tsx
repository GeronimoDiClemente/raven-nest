// Las pantallas grandes entran al palette.
//
// Hasta ahora la única forma de llegar a Personal, Memories, Integrations o el Graph board
// era encontrar su fila en la sidebar — que está colapsada la mitad del tiempo. ⌘K ya sabía
// de pestañas, layouts y snippets, o sea de todo menos de los cuatro destinos que la app
// acaba de unificar bajo la misma cáscara.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CommandPalette from '../../components/CommandPalette'

function base() {
  return {
    onClose: vi.fn(),
    tabs: [],
    activeTabId: 't1',
    focusedPaneId: null,
    broadcastMode: false,
    onTabSelect: vi.fn(),
    onWorkspaceLoad: vi.fn(),
    onSnippetSend: vi.fn(),
    onSnippetBroadcast: vi.fn(),
    onHistoryOpen: vi.fn(),
    onNewTab: vi.fn(),
    onNewPane: vi.fn(),
    onBroadcastToggle: vi.fn(),
    onHubOpen: vi.fn(),
  }
}

beforeEach(() => {
  // El palette carga las tres listas apenas monta; sin el puente el efecto rechaza y el
  // test cuenta un error suelto que puede tapar uno real.
  ;(window as unknown as Record<string, unknown>).workspaces = { list: vi.fn().mockResolvedValue([]) }
  ;(window as unknown as Record<string, unknown>).snippets = { list: vi.fn().mockResolvedValue([]) }
  ;(window as unknown as Record<string, unknown>).conversations = { list: vi.fn().mockResolvedValue([]) }
})

describe('CommandPalette — las pantallas', () => {
  it('lista las cuatro pantallas cuando el host sabe abrirlas', () => {
    render(<CommandPalette {...base()}
      onPersonalOpen={vi.fn()} onMemoriesOpen={vi.fn()}
      onIntegrationsOpen={vi.fn()} onGraphBoardOpen={vi.fn()} />)
    expect(screen.getByText('Screens')).toBeInTheDocument()
    for (const nombre of ['Personal', 'Memories', 'Integrations', 'Graph board']) {
      expect(screen.getByText(nombre)).toBeInTheDocument()
    }
  })

  // Una fila que no lleva a ningún lado es peor que no tener la fila: el usuario la elige,
  // no pasa nada, y deja de confiar en el palette entero.
  it('no dibuja la fila de una pantalla que el host no puede abrir', () => {
    render(<CommandPalette {...base()} onMemoriesOpen={vi.fn()} />)
    expect(screen.getByText('Memories')).toBeInTheDocument()
    expect(screen.queryByText('Personal')).not.toBeInTheDocument()
    expect(screen.queryByText('Graph board')).not.toBeInTheDocument()
  })

  it('sin ninguna pantalla no aparece ni el encabezado de la sección', () => {
    render(<CommandPalette {...base()} />)
    expect(screen.queryByText('Screens')).not.toBeInTheDocument()
  })

  it('elegir una abre esa pantalla y cierra el palette', () => {
    const props = base()
    const onMemoriesOpen = vi.fn()
    render(<CommandPalette {...props} onMemoriesOpen={onMemoriesOpen} />)
    // `mouseDown`, no `click`: las filas se activan en mousedown con `preventDefault` para
    // que el input no pierda el foco, así que un `click` no las dispara.
    fireEvent.mouseDown(screen.getByText('Memories'))
    expect(onMemoriesOpen).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  // El filtro es lo que hace que valgan la pena: escribir "mem" tiene que dejar Memories y
  // sacar del medio las otras tres.
  it('el filtro las encuentra por nombre', () => {
    render(<CommandPalette {...base()}
      onPersonalOpen={vi.fn()} onMemoriesOpen={vi.fn()}
      onIntegrationsOpen={vi.fn()} onGraphBoardOpen={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'memo' } })
    expect(screen.getByText('Memories')).toBeInTheDocument()
    expect(screen.queryByText('Integrations')).not.toBeInTheDocument()
  })
})
