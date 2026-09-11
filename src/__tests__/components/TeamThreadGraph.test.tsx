// Los contratos del grafo de ramas, después de que pasó a dibujarse en 3D (2026-09-11).
//
// Antes estos tests buscaban `<circle role="button">` en el SVG. Ahora el render es un canvas
// WebGL: no hay nodos que buscar, y jsdom no lo ejecuta. Los contratos NO se perdieron, se
// verifican donde ahora viven:
//
// - Lo que cada nodo SIGNIFICA (color por frescura, tamaño por foco, el estado y la frescura
//   dichos en texto y no sólo en color) es una traducción pura: `src/lib/thread-graph-3d.ts`,
//   con sus propios tests.
// - Lo que este archivo sigue cubriendo es lo de ACÁ: el toggle global/local, que un click en
//   un nodo abra la nota de esa rama, y que apagado no se dibuje nada. Para eso se dobla
//   `Graph3DLazy` por un render que pinta un botón por nodo — el doble reemplaza al canvas,
//   no a la lógica del componente, que es la que se está probando.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TeamThreadGraph } from '../../components/TeamThreadGraph'
import type { TeamThreadBranch } from '../../types'

// El doble del render 3D. Pinta un botón por nodo con su etiqueta, que es lo mínimo para
// poder afirmar sobre cuántos nodos hay y qué pasa al tocarlos.
vi.mock('../../components/Graph3DLazy', () => ({
  prefetchGraph3D: vi.fn(),
  LazyGraph3D: ({ nodes, onSelect }: {
    nodes: Array<{ id: string; label: string }>
    onSelect: (id: string | null) => void
  }) => (
    <div data-testid="grafo-3d">
      {nodes.map((n) => (
        <button key={n.id} type="button" onClick={() => onSelect(n.id)}>{n.label}</button>
      ))}
    </div>
  ),
}))

const AHORA = Date.UTC(2026, 8, 8, 12, 0)

const BRANCHES: TeamThreadBranch[] = [
  { slug: 'sidebar', branch: 'feat/sidebar-tabs', estado: 'activa', ultimoAutor: 'Bauti', ultimaEntrada: AHORA - 3600_000, entradas: 2 },
  { slug: 'bridge', branch: 'smoke/memory-bridge', estado: 'cerrada', ultimoAutor: 'Gero', ultimaEntrada: AHORA - 40 * 86400_000, entradas: 5 },
]

/** Los botones de las RAMAS, sin el del nodo central ni los del header. */
function ramas() {
  return screen.queryAllByRole('button').filter((b) => /—/.test(b.textContent ?? ''))
}

describe('TeamThreadGraph', () => {
  // El default es GLOBAL. El grafo sintetiza una estrella `_index -> rama` y no lee los
  // wikilinks de las notas, con lo cual el modo local colapsa a "el foco solo" — un nodo.
  it('global por default: hay un nodo por rama', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    expect(ramas()).toHaveLength(2)
  })

  it('"Show current branch" pasa a local: queda solo la rama en foco', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    fireEvent.click(screen.getByText('Show current branch'))
    expect(ramas()).toHaveLength(1)
  })

  it('y se puede volver a global', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    fireEvent.click(screen.getByText('Show current branch'))
    fireEvent.click(screen.getByText('Show all branches'))
    expect(ramas()).toHaveLength(2)
  })

  it('el click en un nodo abre la nota de esa rama', () => {
    const onOpenNote = vi.fn()
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={onOpenNote} />)
    fireEvent.click(screen.getByText(/feat\/sidebar-tabs/))
    expect(onOpenNote).toHaveBeenCalledWith('sidebar')
  })

  // El nodo central es sintético: no hay ninguna nota que abrir. Tocarlo sólo resalta su
  // vecindario; si abriera algo, abriría un archivo que no existe.
  it('el nodo central NO abre ninguna nota', () => {
    const onOpenNote = vi.fn()
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={onOpenNote} />)
    fireEvent.click(screen.getByText('All branches'))
    expect(onOpenNote).not.toHaveBeenCalled()
  })

  it('apagado muestra el llamado a activarlo y ningun nodo', () => {
    render(<TeamThreadGraph branches={[]} focus={null} ahora={AHORA} enabled={false} onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    expect(screen.getByText(/share this project's thread/i)).toBeInTheDocument()
    expect(screen.queryByTestId('grafo-3d')).not.toBeInTheDocument()
  })

  // Sin notas todavía, el único nodo es el índice. Hasta el 2026-09-11 eso dibujaba un
  // viewBox de 800×800 con UN punto blanco en el medio: lo peor de los dos mundos, ocupa
  // muchísimo y no dice nada.
  it('con una sola rama sintetica no dibuja un cuadro, lo dice', () => {
    render(<TeamThreadGraph branches={[]} focus={null} ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    expect(screen.getByText(/no branch notes yet/i)).toBeInTheDocument()
    expect(screen.queryByTestId('grafo-3d')).not.toBeInTheDocument()
  })
})
