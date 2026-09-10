import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { cn as cnLocal } from '@/lib/utils'
import { cn as cnPkg } from 'cn'

// Conviven DOS implementaciones de cn, y es a proposito: los componentes stock de
// shadcn importan el paquete `cn` (su style radix-nova lo hardcodea, ignorando el
// alias de components.json), y los componentes NUESTROS importan @/lib/utils.
// Este test existe para que esa duplicacion no se vuelva una divergencia: el dia
// que las dos dejen de coincidir, se entera acá y no en la UI.
describe('cn — las dos implementaciones coinciden', () => {
  const casos: Array<[unknown[], string]> = [
    [['p-2', 'p-4'], 'p-4'],
    [['text-fs-sm', 'font-medium'], 'text-fs-sm font-medium'],
    [['bg-card', 'bg-popover'], 'bg-popover'],
    [['rounded-md', 'rounded-lg'], 'rounded-lg'],
    // El filtrado de falsy al estilo clsx también tiene que coincidir.
    [['text-fs-sm', false && 'hidden', 'font-medium'], 'text-fs-sm font-medium'],
  ]
  it.each(casos)('resuelve %j igual en las dos', (entrada, esperado) => {
    expect(cnLocal(...entrada)).toBe(esperado)
    expect(cnPkg(...entrada)).toBe(esperado)
  })
})

describe('shadcn en Nest', () => {
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
