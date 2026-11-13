// Spec 2026-10-19 (memories vista y settings) §5: el color de un tipo sale de la paleta
// ANSI del tema de terminal del usuario, no de hexes fijos — la cobertura de
// memoryTypeSwatch/MEMORY_TYPE_ANSI contra los temas vive en memory-type-colors.test.ts.
// Este archivo cubre lo que no es responsabilidad de ese: el label legible, que un tipo
// desconocido no inventa color, y que ningún color coincida con los tokens de estado.
import { describe, it, expect } from 'vitest'
import { memoryTypeSwatch, MEMORY_TYPES_IN_LEGEND_ORDER } from '../../lib/memory-type-legend'

describe('memoryTypeSwatch', () => {
  it('el label es legible, no el valor crudo', () => {
    expect(memoryTypeSwatch('decision')?.label).toBe('Decision')
  })

  it('un tipo desconocido no inventa un color', () => {
    expect(memoryTypeSwatch('something-new')).toBeNull()
  })

  it('ningun color coincide con los tokens de estado (--ok/--warn/--destructive)', () => {
    const STATUS_HEXES = new Set(['#4ade80', '#e3b341', '#ff6568'])
    for (const t of MEMORY_TYPES_IN_LEGEND_ORDER) {
      expect(STATUS_HEXES.has(memoryTypeSwatch(t)!.color)).toBe(false)
    }
  })
})
