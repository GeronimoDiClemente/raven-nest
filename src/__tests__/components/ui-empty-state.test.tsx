import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from '@/components/ui/empty-state'

describe('EmptyState', () => {
  it('es una caja de borde punteado, centrada', () => {
    render(<EmptyState title="Nothing here" data-testid="e" />)
    const raiz = screen.getByTestId('e')
    expect(raiz.classList.contains('border-dashed')).toBe(true)
    expect(raiz.className).toMatch(/text-center|items-center|justify-center/)
  })

  it('muestra título, descripción y acción', () => {
    render(<EmptyState title="Nothing here" description="Add one to start" action={<button>Add</button>} />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByText('Add one to start')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('con sólo el título no renderiza acción', () => {
    render(<EmptyState title="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('mezcla className y pasa el resto de props al raíz', () => {
    render(<EmptyState title="T" className="mi-clase" data-testid="e" aria-label="empty" />)
    const raiz = screen.getByTestId('e')
    expect(raiz.classList.contains('mi-clase')).toBe(true)
    expect(raiz.classList.contains('border-dashed')).toBe(true)
    expect(raiz).toHaveAttribute('aria-label', 'empty')
  })
})
