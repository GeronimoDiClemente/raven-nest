import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Kbd } from '@/components/ui/kbd'

describe('Kbd', () => {
  it('renderiza un <kbd> con su texto', () => {
    render(<Kbd>⌘K</Kbd>)
    const k = screen.getByText('⌘K')
    expect(k.tagName).toBe('KBD')
  })

  it('usa fuente mono, borde y rounded-sm', () => {
    render(<Kbd>Esc</Kbd>)
    const k = screen.getByText('Esc')
    for (const c of ['font-mono', 'border', 'rounded-sm']) expect(k.classList.contains(c), c).toBe(true)
  })

  it('mezcla className y pasa el resto de props', () => {
    render(<Kbd className="mi-clase" title="t">K</Kbd>)
    const k = screen.getByText('K')
    expect(k.classList.contains('mi-clase')).toBe(true)
    expect(k.classList.contains('font-mono')).toBe(true)
    expect(k).toHaveAttribute('title', 't')
  })
})
