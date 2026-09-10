import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

describe('shadcn en Nest', () => {
  it('cn() resuelve conflictos de Tailwind, no sólo concatena', () => {
    // Es la razón de existir de tailwind-merge: la última gana.
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-fs-sm', false && 'hidden', 'font-medium')).toBe('text-fs-sm font-medium')
  })

  it('el Button monta y respeta la variante', () => {
    render(<Button variant="secondary" size="sm">Guardar</Button>)
    const b = screen.getByRole('button', { name: 'Guardar' })
    expect(b).toBeInTheDocument()
    expect(b.className).toMatch(/bg-secondary/)
  })

  it('asChild delega en el hijo en vez de anidar botones', () => {
    render(<Button asChild><a href="#x">Ir</a></Button>)
    expect(screen.getByRole('link', { name: 'Ir' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
