import { describe, it, expect } from 'vitest'
import { AI_LOGOS } from '../../components/AILogos'
import { PICKER_AI_TYPES, AI_CONFIG } from '../../types'
import type { AIType } from '../../types'

// Tipos que NO son agentes: no llevan logo de marca.
const SIN_LOGO: AIType[] = ['terminal', 'browser', 'custom', 'editor']

describe('AI_LOGOS — el mapa único de logos', () => {
  // Antes este mapa estaba duplicado en cuatro componentes (picker, header del
  // pane, sidebar del Hub, popover de recursos). Los cinco CLIs nuevos entraron
  // con logo solo en el picker y en el resto quedaban con un punto gris.
  it('todos los agentes del picker tienen logo', () => {
    const agentes = PICKER_AI_TYPES.filter((t) => !SIN_LOGO.includes(t))
    const sinLogo = agentes.filter((t) => !AI_LOGOS[t])
    expect(sinLogo).toEqual([])
  })

  it('cubre a todos los agentes de AI_CONFIG, no solo a los del picker', () => {
    const agentes = (Object.keys(AI_CONFIG) as AIType[]).filter((t) => !SIN_LOGO.includes(t))
    for (const t of agentes) expect(AI_LOGOS[t]).toBeTruthy()
  })

  it('no le inventa logo a la terminal ni al browser', () => {
    for (const t of SIN_LOGO) expect(AI_LOGOS[t]).toBeUndefined()
  })
})
