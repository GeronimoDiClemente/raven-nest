import { describe, it, expect } from 'vitest'
import { outlineDe } from '../../lib/memory-outline'
describe('outlineDe', () => {
  it('encabezados ATX con nivel y linea, ignorando bloques de codigo', () => {
    expect(outlineDe('# A\ntexto\n```\n# no\n```\n## B')).toEqual([
      { nivel: 1, texto: 'A', linea: 1 }, { nivel: 2, texto: 'B', linea: 6 },
    ])
  })
})
