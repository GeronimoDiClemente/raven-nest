import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MemoriesExplorer from '../../components/memories/MemoriesExplorer'

const nodo = (syncId: string, title: string) => ({ syncId, title, projectKey: 'p1', projectDisplayName: 'raven-nest', tags: [], type: 'decision', scope: 'personal' as const, topicKey: null, gitBranch: null, originAi: null, authorDisplay: null, updatedAt: 1, superseded: false })
const base = () => ({
  carpetas: [{ id: 'project:p1', nombre: 'raven-nest', items: [nodo('a', 'Auth pasa a cookies')] }, { id: 'team', nombre: 'Team', items: [nodo('t', 'Rate limit')] }],
  query: '', onQuery: vi.fn(), activoId: null, carpetaSeleccionada: null, onSeleccionarCarpeta: vi.fn(),
  onOpen: vi.fn(), onNew: vi.fn(), truncadas: 0, cargando: false,
})

describe('MemoriesExplorer', () => {
  beforeEach(() => localStorage.clear())

  it('carpetas con contador; abrir una memoria; ctrl+click en segundo plano', () => {
    const p = base()
    render(<MemoriesExplorer {...p} />)
    expect(screen.getByRole('button', { name: /raven-nest 1/ })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Auth pasa a cookies' }))
    expect(p.onOpen).toHaveBeenLastCalledWith('a', { background: false })
    fireEvent.click(screen.getByRole('button', { name: 'Auth pasa a cookies' }), { metaKey: true })
    expect(p.onOpen).toHaveBeenLastCalledWith('a', { background: true })
  })
  it('cerrar una carpeta esconde sus memorias y se recuerda', () => {
    const { unmount } = render(<MemoriesExplorer {...base()} />)
    fireEvent.click(screen.getByRole('button', { name: /raven-nest 1/ }))
    expect(screen.queryByRole('button', { name: 'Auth pasa a cookies' })).toBeNull()
    unmount()
    render(<MemoriesExplorer {...base()} />)
    expect(screen.queryByRole('button', { name: 'Auth pasa a cookies' })).toBeNull()
  })
  it('con una busqueda activa, click en una carpeta la elige pero no guarda un cerrado', () => {
    const p = { ...base(), query: 'auth' }
    const { unmount } = render(<MemoriesExplorer {...p} />)
    fireEvent.click(screen.getByRole('button', { name: /raven-nest 1/ }))
    expect(p.onSeleccionarCarpeta).toHaveBeenCalledWith('project:p1')
    expect(screen.getByRole('button', { name: 'Auth pasa a cookies' })).toBeInTheDocument()
    unmount()
    render(<MemoriesExplorer {...base()} />)
    expect(screen.getByRole('button', { name: /raven-nest 1/ })).toHaveAttribute('aria-expanded', 'true')
  })
  it('avisa cuantas quedaron afuera del grafo (Review Focus 4)', () => {
    render(<MemoriesExplorer {...base()} truncadas={12} />)
    expect(screen.getByText('12 more not shown')).toBeInTheDocument()
  })
  it('sin carpetas dice No memories yet', () => {
    render(<MemoriesExplorer {...base()} carpetas={[]} />)
    expect(screen.getByText('No memories yet')).toBeInTheDocument()
  })
  it('cargando sin carpetas dice Loading; con busqueda sin carpetas dice No matches', () => {
    const { rerender } = render(<MemoriesExplorer {...base()} carpetas={[]} cargando />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    rerender(<MemoriesExplorer {...base()} carpetas={[]} query="zzz" />)
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })
  it('con busqueda todas las carpetas se ven abiertas sin pisar lo recordado', () => {
    localStorage.setItem('nest:memories:carpetas', JSON.stringify(['project:p1']))
    const { rerender } = render(<MemoriesExplorer {...base()} query="a" />)
    expect(screen.getByRole('button', { name: 'Auth pasa a cookies' })).toBeInTheDocument()
    expect(localStorage.getItem('nest:memories:carpetas')).toBe(JSON.stringify(['project:p1']))
    rerender(<MemoriesExplorer {...base()} query="" />)
    expect(screen.queryByRole('button', { name: 'Auth pasa a cookies' })).toBeNull()
  })
  it('JSON corrupto en el storage vuelve a todo abierto', () => {
    localStorage.setItem('nest:memories:carpetas', '{no es json')
    render(<MemoriesExplorer {...base()} />)
    expect(screen.getByRole('button', { name: 'Auth pasa a cookies' })).toBeInTheDocument()
  })
  it('la fila activa tiene aria-current; click en carpeta la selecciona; New memory y query', () => {
    const p = base()
    render(<MemoriesExplorer {...p} activoId="a" />)
    expect(screen.getByRole('button', { name: 'Auth pasa a cookies' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: /Team 1/ }))
    expect(p.onSeleccionarCarpeta).toHaveBeenCalledWith('team')
    fireEvent.click(screen.getByRole('button', { name: 'New memory' }))
    expect(p.onNew).toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Search memories'), { target: { value: 'x' } })
    expect(p.onQuery).toHaveBeenCalledWith('x')
  })
})
