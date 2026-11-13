// Review final de rama, IMPORTANT #6: el paso "graph" del tour de Memories describia un
// gesto que no existe — "o arrastrás uno sobre otro". Conectar dos memorias es
// "Connect to another memory" (en el menu ⋯ de la pestaña de la memoria, desde el 20-10) y
// despues un click en la otra memoria del explorer o del grafo; nunca un drag.
import { describe, it, expect } from 'vitest'
import { memoriesTour } from '../../tutorial/tours/memories'

describe('memoriesTour — el paso del grafo describe el gesto real de conectar', () => {
  const paso = memoriesTour.steps.find((s) => s.id === 'graph')!

  it('no promete arrastrar una memoria sobre otra', () => {
    expect(paso.body.en.toLowerCase()).not.toMatch(/drag/)
  })

  it('describe el gesto real: Connect to another memory + click en la otra', () => {
    expect(paso.body.en).toMatch(/Connect to another memory/)
  })
})

describe('memoriesTour — la forma estilo Obsidian (20-10)', () => {
  it('recorre explorer, grafo y pestañas, con sus anclas nuevas', () => {
    const anclas = Object.fromEntries(memoriesTour.steps.map((s) => [s.id, s.anchor]))
    expect(memoriesTour.steps.map((s) => s.id)).toEqual(['status', 'explorer', 'graph', 'tabs', 'new', 'settings'])
    expect(anclas.explorer).toBe('[data-tour-id="memories-explorer"]')
    expect(anclas.graph).toBe('[data-tour-id="memories-graph"]')
    expect(anclas.tabs).toBe('[data-tour-id="memories-tabs"]')
    expect(anclas.new).toBe('[data-tour-id="memories-new"]')
  })
})
