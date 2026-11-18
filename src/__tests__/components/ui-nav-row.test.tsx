import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NavRow } from '@/components/ui/nav-row'

describe('NavRow', () => {
  it('siempre es <button type="button"> con sus children, aun sin onClick', () => {
    render(<NavRow>Sessions</NavRow>)
    const b = screen.getByRole('button', { name: 'Sessions' })
    expect(b.tagName).toBe('BUTTON')
    expect(b).toHaveAttribute('type', 'button')
  })

  it('llama onClick', () => {
    const onClick = vi.fn()
    render(<NavRow onClick={onClick}>Sessions</NavRow>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('hover y activo usan los tokens de fila', () => {
    render(<NavRow>Sessions</NavRow>)
    const b = screen.getByRole('button')
    expect(b.classList.contains('hover:bg-sidebar-row-hover')).toBe(true)
    expect(b.classList.contains('active:bg-sidebar-row-active')).toBe(true)
  })

  it('selected: aria-current="true", bg-sidebar-row-selected y text-foreground', () => {
    render(<NavRow selected>Sessions</NavRow>)
    const b = screen.getByRole('button')
    expect(b).toHaveAttribute('aria-current', 'true')
    expect(b.classList.contains('bg-sidebar-row-selected')).toBe(true)
    expect(b.classList.contains('text-foreground')).toBe(true)
  })

  it('sin selected no marca aria-current="true" ni pinta bg-sidebar-row-selected', () => {
    render(<NavRow>Sessions</NavRow>)
    const b = screen.getByRole('button')
    expect(b.getAttribute('aria-current')).not.toBe('true')
    expect(b.classList.contains('bg-sidebar-row-selected')).toBe(false)
  })

  it('muestra el ícono y el count; el count lleva tabular-nums', () => {
    render(<NavRow icon={<svg data-testid="ico" />} count={12}>Sessions</NavRow>)
    expect(screen.getByTestId('ico')).toBeInTheDocument()
    expect(screen.getByText('12').closest('.tabular-nums')).not.toBeNull()
  })

  it('count a la derecha: va después de los children en el documento', () => {
    render(<NavRow count={3}>Sessions</NavRow>)
    const texto = screen.getByText('Sessions')
    const count = screen.getByText('3')
    expect(texto.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('countTone="warn" pinta el count en text-warn; el default no', () => {
    const { unmount } = render(<NavRow count={3} countTone="warn">A</NavRow>)
    expect(screen.getByText('3').closest('.text-warn')).not.toBeNull()
    unmount()
    render(<NavRow count={3}>A</NavRow>)
    expect(screen.getByText('3').closest('.text-warn')).toBeNull()
  })

  it('mezcla className y pasa el resto de props', () => {
    render(<NavRow className="mi-clase" data-testid="n" title="t">A</NavRow>)
    const n = screen.getByTestId('n')
    expect(n.classList.contains('mi-clase')).toBe(true)
    expect(n).toHaveAttribute('title', 't')
  })
})
