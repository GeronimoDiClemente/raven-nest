import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { cn as cnLocal } from '@/lib/utils'
import { cn as cnPkg } from 'cn'
import type { ClassValue } from 'clsx'

// Los componentes stock de shadcn importan el paquete `cn` (su style radix-nova lo
// hardcodea, ignorando el alias de components.json), y los componentes NUESTROS
// importan @/lib/utils. Hasta Task 8b eran DOS implementaciones distintas que este
// test comparaba por valor. Desde Task 8b, vitest.config.ts aliasea el módulo "cn" a
// @/lib/utils (los dos necesitan la escala --fs-*, que el paquete no conoce — ver
// src/__tests__/lib/cn-escala.test.ts), así que ya es la MISMA implementación: el
// import de "cn" resuelve al mismo módulo. El test se queda, pero ahora afirma eso.
describe('cn — el paquete "cn" y @/lib/utils son la misma implementación (alias de test config)', () => {
  it('cnPkg es literalmente cnLocal — mismo módulo por el alias, no una coincidencia de valores', () => {
    expect(cnPkg).toBe(cnLocal)
  })

  const casos: Array<[ClassValue[], string]> = [
    [['p-2', 'p-4'], 'p-4'],
    [['text-fs-sm', 'font-medium'], 'text-fs-sm font-medium'],
    [['bg-card', 'bg-popover'], 'bg-popover'],
    [['rounded-md', 'rounded-lg'], 'rounded-lg'],
    // El filtrado de falsy al estilo clsx también tiene que coincidir.
    [['text-fs-sm', false && 'hidden', 'font-medium'], 'text-fs-sm font-medium'],
    // El caso que motivó Task 8b: tamaño de nuestra escala + color, los dos sobreviven.
    [['text-fs-sm', 'text-destructive'], 'text-fs-sm text-destructive'],
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
