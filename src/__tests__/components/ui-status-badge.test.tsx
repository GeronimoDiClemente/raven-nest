import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { StatusBadge } from '@/components/ui/status-badge'

const casos = [
  ['ok', 'text-ok', 'bg-ok-surface'],
  ['warn', 'text-warn', 'bg-warn-surface'],
  ['destructive', 'text-destructive', 'bg-destructive-surface'],
  ['info', 'text-info', 'bg-info-surface'],
  ['muted', 'text-muted-foreground', 'bg-sidebar-row-active'],
] as const

describe('StatusBadge', () => {
  it.each(casos)('tone=%s pone data-tone, %s y %s en el raíz', (tone, texto, fondo) => {
    const { container } = render(<StatusBadge tone={tone}>Label</StatusBadge>)
    const raiz = container.firstElementChild as HTMLElement
    expect(raiz).toHaveAttribute('data-tone', tone)
    expect(raiz.classList.contains(texto)).toBe(true)
    expect(raiz.classList.contains(fondo)).toBe(true)
    expect(raiz).toHaveTextContent('Label')
  })

  it('un tono no usa las clases de otro', () => {
    const { container } = render(<StatusBadge tone="ok">Label</StatusBadge>)
    const raiz = container.firstElementChild as HTMLElement
    expect(raiz.classList.contains('bg-warn-surface')).toBe(false)
    expect(raiz.classList.contains('text-warn')).toBe(false)
  })

  it('mezcla className y pasa el resto de props al raíz', () => {
    const { container } = render(<StatusBadge tone="info" className="mi-clase" title="t">x</StatusBadge>)
    const raiz = container.firstElementChild as HTMLElement
    expect(raiz.classList.contains('mi-clase')).toBe(true)
    expect(raiz.classList.contains('bg-info-surface')).toBe(true)
    expect(raiz).toHaveAttribute('title', 't')
  })
})
