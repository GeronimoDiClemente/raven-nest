import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import MemoryNoteEditor from '../../components/memories/MemoryNoteEditor'
import type { MemoryObservationDetail } from '../../types'

const det = (o: Partial<MemoryObservationDetail> = {}): MemoryObservationDetail => ({
  syncId: 's1', projectKey: 'p1', scope: 'personal', type: 'decision', title: 'Auth', content: 'ver [[Otra]] y [[Falta]]',
  tags: [], topicKey: null, gitBranch: 'main', originAi: null, authorDisplay: null, createdAt: 1, updatedAt: 1,
  supersededBy: null, revisionCount: 1, links: [{ name: 'Otra', syncId: 's2' }, { name: 'Falta', syncId: null }], mentionedIn: [], ...o,
})
const props = () => ({
  ansi: undefined, candidatos: [], externo: null,
  onSave: vi.fn().mockResolvedValue({ ok: true }), onOpen: vi.fn(), onCreate: vi.fn(),
  onOpenNewer: vi.fn(), onConnect: vi.fn(), onDelete: vi.fn().mockResolvedValue(undefined),
})

describe('MemoryNoteEditor', () => {
  it('muestra el titulo editable y el contenido sin HTML', () => {
    render(<MemoryNoteEditor detail={det({ content: '<img src=x onerror=alert(1)>' })} {...props()} />)
    expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveValue('Auth')
    expect(document.querySelector('.cm-content img')).toBeNull()
  })
  it('click en un link resuelto abre; en uno pendiente ofrece crearla', () => {
    const p = props()
    render(<MemoryNoteEditor detail={det()} {...p} />)
    fireEvent.mouseDown(document.querySelector('[data-wikilink="Otra"]')!)
    expect(p.onOpen).toHaveBeenCalledWith('s2', { background: false })
    fireEvent.mouseDown(document.querySelector('[data-wikilink="Falta"]')!)
    fireEvent.click(screen.getByRole('button', { name: 'Create this memory' }))
    expect(p.onCreate).toHaveBeenCalledWith('Falta')
  })
  it('un wikilink hostil que no esta en los links no abre ni crea nada (Review Focus 5)', () => {
    const p = props()
    render(<MemoryNoteEditor detail={det({ content: 'mira [[javascript:alert(1)]]', links: [] })} {...p} />)
    fireEvent.mouseDown(document.querySelector('[data-wikilink="javascript:alert(1)"]')!)
    expect(p.onOpen).not.toHaveBeenCalled()
    expect(p.onCreate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Create this memory' })).toBeNull()
    expect(document.querySelector('a[href]')).toBeNull()
  })
  it('cambio externo sin cambios locales recarga; con cambios locales muestra la banda (Review Focus 3)', () => {
    const p = props()
    const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'Auth v2', updatedAt: 2 })} />)
    expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveValue('Auth v2')
    fireEvent.change(screen.getByRole('textbox', { name: 'Memory title' }), { target: { value: 'Mio' } })
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'Auth v3', updatedAt: 3 })} />)
    expect(screen.getByText(/A newer version replaced this one/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveValue('Mio')
  })
  it('el eco de nuestro propio guardado no se toma como cambio externo aunque se siga escribiendo', async () => {
    vi.useFakeTimers()
    try {
      const p = props()
      const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
      const titulo = () => screen.getByRole('textbox', { name: 'Memory title' })
      fireEvent.change(titulo(), { target: { value: 'A1' } })
      await act(async () => { vi.advanceTimersByTime(1500) })
      expect(p.onSave).toHaveBeenCalledWith({ title: 'A1', content: 'ver [[Otra]] y [[Falta]]' })
      fireEvent.change(titulo(), { target: { value: 'A12' } })
      rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'A1', updatedAt: 2 })} />)
      expect(screen.queryByText(/A newer version replaced this one/)).toBeNull()
      expect(titulo()).toHaveValue('A12')
      expect(titulo()).not.toHaveAttribute('readonly')
    } finally {
      vi.useRealTimers()
    }
  })
  it('un cambio externo recarga tambien el cuerpo del editor', () => {
    const p = props()
    const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ content: 'cuerpo nuevo', updatedAt: 2 })} />)
    expect(document.querySelector('.cm-content')?.textContent).toBe('cuerpo nuevo')
  })
  it('una memoria reemplazada es solo lectura y ofrece abrir la nueva', () => {
    const p = props()
    render(<MemoryNoteEditor detail={det({ supersededBy: 's9' })} {...p} />)
    expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open the newer version' }))
    expect(p.onOpenNewer).toHaveBeenCalled()
  })
})
