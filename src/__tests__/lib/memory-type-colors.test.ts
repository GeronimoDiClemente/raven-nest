import { describe, it, expect } from 'vitest'
import { memoryTypeSwatch, MEMORY_TYPE_ANSI } from '../../lib/memory-type-legend'
import { TEMA_NEST, TEMAS } from '../../lib/terminal-themes'

describe('color por tipo = ANSI del tema', () => {
  it('cada tipo conocido sale de su índice ANSI', () => {
    const tema = TEMAS[1]
    expect(memoryTypeSwatch('decision', tema.ansi)?.color).toBe(tema.ansi[4])
    expect(memoryTypeSwatch('bugfix', tema.ansi)?.color).toBe(tema.ansi[1])
    expect(memoryTypeSwatch('architecture', tema.ansi)?.color).toBe(tema.ansi[5])
    expect(memoryTypeSwatch('discovery', tema.ansi)?.color).toBe(tema.ansi[6])
    expect(memoryTypeSwatch('pattern', tema.ansi)?.color).toBe(tema.ansi[2])
    expect(memoryTypeSwatch('handoff', tema.ansi)?.color).toBe(tema.ansi[3])
    for (const t of ['config', 'preference', 'session'] as const) {
      expect(memoryTypeSwatch(t, tema.ansi)?.color).toBe(tema.ansi[8])
    }
  })
  it('sin paleta, o con una paleta rota, cae al tema Nest', () => {
    expect(memoryTypeSwatch('decision')?.color).toBe(TEMA_NEST.ansi[4])
    expect(memoryTypeSwatch('decision', [])?.color).toBe(TEMA_NEST.ansi[4])
  })
  it('un tipo desconocido no inventa color', () => {
    expect(memoryTypeSwatch('nada', TEMA_NEST.ansi)).toBeNull()
  })
  it('los nueve tipos tienen índice', () => {
    expect(Object.keys(MEMORY_TYPE_ANSI).sort()).toEqual(
      ['architecture', 'bugfix', 'config', 'decision', 'discovery', 'handoff', 'pattern', 'preference', 'session'])
  })
})
