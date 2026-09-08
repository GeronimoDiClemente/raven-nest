import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TeamThreadGraph } from '../../components/TeamThreadGraph'
import type { TeamThreadBranch } from '../../types'

const AHORA = Date.UTC(2026, 8, 8, 12, 0)

const BRANCHES: TeamThreadBranch[] = [
  { slug: 'sidebar', branch: 'feat/sidebar-tabs', estado: 'activa', ultimoAutor: 'Bauti', ultimaEntrada: AHORA - 3600_000, entradas: 2 },
  { slug: 'bridge', branch: 'smoke/memory-bridge', estado: 'cerrada', ultimoAutor: 'Gero', ultimaEntrada: AHORA - 40 * 86400_000, entradas: 5 },
]

describe('TeamThreadGraph', () => {
  // I5: el default es GLOBAL. El grafo sintetiza una estrella `_index -> rama` y no lee los
  // wikilinks de las notas, con lo cual el modo local colapsa a "el foco solo" — un nodo.
  it('global por default: dibuja un nodo por rama', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /open note/i })).toHaveLength(2)
  })

  it('"Show current branch" pasa a local: queda solo la rama en foco', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    fireEvent.click(screen.getByText('Show current branch'))
    expect(screen.getAllByRole('button', { name: /open note/i })).toHaveLength(1)
  })

  it('y se puede volver a global', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    fireEvent.click(screen.getByText('Show current branch'))
    fireEvent.click(screen.getByText('Show all branches'))
    expect(screen.getAllByRole('button', { name: /open note/i })).toHaveLength(2)
  })

  it('el click en un nodo abre la nota de esa rama', () => {
    const onOpenNote = vi.fn()
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={onOpenNote} />)
    fireEvent.click(screen.getByRole('button', { name: /open note for feat\/sidebar-tabs/i }))
    expect(onOpenNote).toHaveBeenCalledWith('sidebar')
  })

  it('distingue visualmente lo cerrado y lo viejo', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    const cerrada = screen.getByRole('button', { name: /open note for smoke\/memory-bridge/i })
    expect(cerrada).toHaveAttribute('data-estado', 'cerrada')
    expect(cerrada).toHaveAttribute('data-frescura', 'viejo')
  })

  it('el estado y la frescura tambien viajan en el aria-label, no solo en color/borde', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    expect(screen.getByRole('button', { name: /open note for feat\/sidebar-tabs — active, updated today/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open note for smoke\/memory-bridge — closed, stale/i })).toBeInTheDocument()
  })

  it('apagado muestra el llamado a activarlo y ningun nodo', () => {
    render(<TeamThreadGraph branches={[]} focus={null} ahora={AHORA} enabled={false} onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    expect(screen.getByText(/share this project's thread/i)).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /open note/i })).toHaveLength(0)
  })
})
