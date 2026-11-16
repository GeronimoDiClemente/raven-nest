// El color de un worker sale del tema de terminal del usuario por índice ANSI, igual que el de
// un tipo de memoria (memory-type-legend.ts).
import { describe, it, expect } from 'vitest'
import { workerSwatch, WORKER_ANSI } from '../../lib/worker-palette'
import { TEMA_NEST, subirContraste } from '../../lib/terminal-themes'

const FONDO = '#141414'

describe('workerSwatch', () => {
  it('usa los índices 4, 2, 5, 3 (sin el rojo de error)', () => {
    expect([...WORKER_ANSI]).toEqual([4, 2, 5, 3])
    expect(WORKER_ANSI).not.toContain(1)
  })

  it('toma el color de la paleta del tema, con el contraste subido', () => {
    const ansi = Array.from({ length: 16 }, (_, i) => `#${i.toString(16).repeat(6)}`)
    expect(workerSwatch(0, ansi)).toBe(subirContraste(ansi[4], FONDO))
    expect(workerSwatch(1, ansi)).toBe(subirContraste(ansi[2], FONDO))
  })

  it('sin paleta, o con una rota, cae al tema Nest', () => {
    expect(workerSwatch(2)).toBe(subirContraste(TEMA_NEST.ansi[5], FONDO))
    expect(workerSwatch(3, ['#ff0000'])).toBe(subirContraste(TEMA_NEST.ansi[3], FONDO))
  })

  it('un índice fuera de rango cicla en vez de dar undefined', () => {
    expect(workerSwatch(4)).toBe(workerSwatch(0))
    expect(workerSwatch(-1)).toBe(workerSwatch(3))
  })
})
