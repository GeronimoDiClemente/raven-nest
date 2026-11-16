import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MemoryTabs from '../../components/memories/MemoryTabs'

describe('MemoryTabs', () => {
  it('Graph no tiene cerrar; una nota si; el medio cierra', () => {
    const onClose = vi.fn(), onActivate = vi.fn()
    render(<MemoryTabs tabs={[{ kind: 'graph' }, { kind: 'note', syncId: 'a' }]} activeId="graph"
      etiqueta={(t) => ({ texto: t.kind === 'graph' ? 'Graph' : 'Auth' })} onActivate={onActivate} onClose={onClose} />)
    expect(screen.getAllByRole('button', { name: 'Close tab' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: /Auth/ }))
    expect(onActivate).toHaveBeenCalledWith('note:a')
    fireEvent.mouseUp(screen.getByRole('tab', { name: /Auth/ }), { button: 1 })
    expect(onClose).toHaveBeenCalledWith('note:a')
  })
  it('el medio sobre una fija no cierra; la x cierra sin activar', () => {
    const onClose = vi.fn(), onActivate = vi.fn()
    render(<MemoryTabs tabs={[{ kind: 'graph' }, { kind: 'note', syncId: 'a' }]} activeId="graph"
      etiqueta={(t) => ({ texto: t.kind === 'graph' ? 'Graph' : 'Auth', tipo: 'decision' })} onActivate={onActivate} onClose={onClose} />)
    fireEvent.mouseUp(screen.getByRole('tab', { name: /Graph/ }), { button: 1 })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: /Graph/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(onClose).toHaveBeenCalledWith('note:a')
    expect(onActivate).not.toHaveBeenCalled()
  })
  it('Settings se puede cerrar como una pestaña común', () => {
    const onClose = vi.fn()
    render(<MemoryTabs tabs={[{ kind: 'graph' }, { kind: 'settings', section: 'sync' }]} activeId="settings"
      etiqueta={(t) => ({ texto: t.kind === 'graph' ? 'Graph' : 'Settings' })} onActivate={vi.fn()} onClose={onClose} />)
    expect(screen.getByRole('tab', { name: /Settings/, selected: true })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(onClose).toHaveBeenCalledWith('settings')
  })
})
