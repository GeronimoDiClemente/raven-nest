// Spec 2026-09-11 §1: el tipo se distingue sin leer — siete valores fijos con un
// color propio, en orden fijo (nunca ciclado, es el mecanismo de seguridad CVD de la
// skill dataviz).
import { describe, it, expect } from 'vitest'
import { memoryTypeSwatch } from '../../lib/memory-type-legend'

const KNOWN_TYPES = [
  'decision', 'bugfix', 'architecture', 'discovery', 'pattern', 'config', 'preference',
] as const

describe('memoryTypeSwatch', () => {
  it('cada uno de los 7 tipos fijos tiene su propio color, sin repetir', () => {
    const colors = KNOWN_TYPES.map((t) => memoryTypeSwatch(t)?.color)
    expect(colors.every((c) => typeof c === 'string' && c.length > 0)).toBe(true)
    expect(new Set(colors).size).toBe(KNOWN_TYPES.length)
  })

  it('el label es legible, no el valor crudo', () => {
    expect(memoryTypeSwatch('decision')?.label).toBe('Decision')
  })

  it('un tipo interno (session/handoff) no esta en la leyenda fija', () => {
    expect(memoryTypeSwatch('session')).toBeNull()
    expect(memoryTypeSwatch('handoff')).toBeNull()
  })

  it('un tipo desconocido no inventa un color', () => {
    expect(memoryTypeSwatch('something-new')).toBeNull()
  })

  it('ningun color coincide con los tokens de estado (--ok/--warn/--destructive)', () => {
    const STATUS_HEXES = new Set(['#4ade80', '#e3b341', '#ff6568'])
    for (const t of KNOWN_TYPES) {
      expect(STATUS_HEXES.has(memoryTypeSwatch(t)!.color)).toBe(false)
    }
  })
})
