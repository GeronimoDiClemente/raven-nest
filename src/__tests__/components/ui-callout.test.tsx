import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Callout } from '@/components/ui/callout'

const fondos = { warn: 'bg-warn-surface', destructive: 'bg-destructive-surface', info: 'bg-info-surface' } as const

describe('Callout', () => {
  it.each(Object.entries(fondos))('tone=%s: role=status, data-tone y fondo %s', (tone, fondo) => {
    render(<Callout tone={tone as keyof typeof fondos} title="Heads up" />)
    const raiz = screen.getByRole('status')
    expect(raiz).toHaveAttribute('data-tone', tone)
    expect(raiz.classList.contains(fondo)).toBe(true)
  })

  it('el título va en font-medium', () => {
    render(<Callout tone="warn" title="Heads up" />)
    expect(screen.getByText('Heads up').closest('.font-medium')).not.toBeNull()
  })

  it('la descripción (children) va en text-muted-foreground', () => {
    render(<Callout tone="info" title="T">Some detail</Callout>)
    expect(screen.getByText('Some detail').closest('.text-muted-foreground')).not.toBeNull()
  })

  it('renderiza la acción, después del título en el documento', () => {
    render(<Callout tone="destructive" title="Failed" action={<button>Retry</button>}>Detail</Callout>)
    const accion = screen.getByRole('button', { name: 'Retry' })
    const titulo = screen.getByText('Failed')
    expect(titulo.compareDocumentPosition(accion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('sin descripción ni acción renderiza sólo el título', () => {
    render(<Callout tone="warn" title="Only title" />)
    expect(screen.getByText('Only title')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('mezcla className y pasa el resto de props al raíz', () => {
    render(<Callout tone="warn" title="T" className="mi-clase" data-testid="c" />)
    const raiz = screen.getByTestId('c')
    expect(raiz).toBe(screen.getByRole('status'))
    expect(raiz.classList.contains('mi-clase')).toBe(true)
    expect(raiz.classList.contains('bg-warn-surface')).toBe(true)
  })
})
