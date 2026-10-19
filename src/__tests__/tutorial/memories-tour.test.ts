// Review final de rama, IMPORTANT #6: el paso "graph" del tour de Memories describia un
// gesto que no existe — "o arrastrás uno sobre otro". Conectar dos memorias es
// "Connect to another memory" (boton en MemoryGraphPanel.tsx) y despues un click en la
// otra memoria del grafo o de la lista; nunca un drag.
import { describe, it, expect } from 'vitest'
import { memoriesTour } from '../../tutorial/tours/memories'

describe('memoriesTour — el paso del grafo describe el gesto real de conectar', () => {
  const paso = memoriesTour.steps.find((s) => s.id === 'graph')!

  it('no promete arrastrar una memoria sobre otra', () => {
    expect(paso.body.en.toLowerCase()).not.toMatch(/drag/)
  })

  it('describe el boton real: Connect to another memory + click en la otra', () => {
    expect(paso.body.en).toMatch(/Connect to another memory/)
  })
})
