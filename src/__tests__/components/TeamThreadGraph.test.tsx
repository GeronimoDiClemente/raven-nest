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
  it('dibuja un nodo por rama mas el indice', () => {
    render(<TeamThreadGraph branches={BRANCHES} focus="sidebar" ahora={AHORA} enabled onToggle={vi.fn()} onOpenNote={vi.fn()} />)
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

  it('apagado muestra el llamado a activarlo y ningun nodo', () => {
    render(<TeamThreadGraph branches={[]} focus={null} ahora={AHORA} enabled={false} onToggle={vi.fn()} onOpenNote={vi.fn()} />)
    expect(screen.getByText(/share this project's thread/i)).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /open note/i })).toHaveLength(0)
  })
})
