import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { List, ListRow } from '@/components/ui/list'

const tiene = (el: Element, clase: string) => el.classList.contains(clase)

describe('List', () => {
  it('es un contenedor con borde, rounded-md y fondo de card', () => {
    render(<List data-testid="l"><ListRow>a</ListRow></List>)
    const l = screen.getByTestId('l')
    for (const c of ['border', 'border-border', 'rounded-md', 'bg-card']) expect(tiene(l, c), c).toBe(true)
  })

  it('mezcla className con cn y pasa el resto de props al raíz', () => {
    render(<List data-testid="l" className="mi-clase" aria-label="Sessions" />)
    const l = screen.getByTestId('l')
    expect(tiene(l, 'mi-clase')).toBe(true)
    expect(tiene(l, 'rounded-md')).toBe(true)
    expect(l).toHaveAttribute('aria-label', 'Sessions')
  })
})

describe('ListRow', () => {
  it('sin onClick renderiza un div, no un botón', () => {
    render(<ListRow data-testid="r">Row</ListRow>)
    expect(screen.getByTestId('r').tagName).toBe('DIV')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('con onClick renderiza <button type="button"> y lo llama al hacer clic', () => {
    const onClick = vi.fn()
    render(<ListRow onClick={onClick}>Row</ListRow>)
    const b = screen.getByRole('button', { name: 'Row' })
    expect(b.tagName).toBe('BUTTON')
    expect(b).toHaveAttribute('type', 'button')
    fireEvent.click(b)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('selected pone data-selected="true" y bg-sidebar-row-active', () => {
    render(<ListRow selected data-testid="r">Row</ListRow>)
    const r = screen.getByTestId('r')
    expect(r).toHaveAttribute('data-selected', 'true')
    expect(tiene(r, 'bg-sidebar-row-active')).toBe(true)
  })

  it('sin selected no marca data-selected="true" ni usa bg-sidebar-row-active', () => {
    render(<ListRow data-testid="r">Row</ListRow>)
    const r = screen.getByTestId('r')
    expect(r.getAttribute('data-selected')).not.toBe('true')
    expect(tiene(r, 'bg-sidebar-row-active')).toBe(false)
  })

  it('la variante botón tiene hover con bg-sidebar-row-hover', () => {
    render(<ListRow onClick={() => {}}>Row</ListRow>)
    expect(tiene(screen.getByRole('button'), 'hover:bg-sidebar-row-hover')).toBe(true)
  })

  it('mezcla className y pasa el resto de props (también en la variante botón)', () => {
    render(<ListRow onClick={() => {}} className="mi-clase" data-testid="r" aria-label="x">Row</ListRow>)
    const r = screen.getByTestId('r')
    expect(tiene(r, 'mi-clase')).toBe(true)
    expect(r).toHaveAttribute('aria-label', 'x')
  })
})
