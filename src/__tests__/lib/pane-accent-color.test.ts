import { describe, it, expect } from 'vitest'
import { paneAccentColor } from '../../lib/pane-accent-color'
import type { PaneNode } from '../../types'

const pane = (o: Partial<PaneNode> = {}): PaneNode => ({
  id: 'p1', aiType: 'claude', accountName: '', accountDir: '', borderColor: '#0055FF', cmd: '', ...o,
})

describe('paneAccentColor — color con el que se identifica un pane', () => {
  it('usa el color elegido por el usuario', () => {
    expect(paneAccentColor(pane({ borderColor: '#0055FF' }))).toBe('#0055FF')
  })

  // Bug: 'transparent' es el marcador de "sin borde", no un color. Como es un
  // string, el `??` no caía al color del agente y el bullet del sidebar, el
  // color de la lista de panes y el dot del Hub quedaban invisibles.
  it('con el borde apagado cae al color del agente, no a transparente', () => {
    expect(paneAccentColor(pane({ borderColor: 'transparent', aiType: 'claude' }))).toBe('#E07B54')
  })

  it('sin borderColor respeta customColor antes que el del agente', () => {
    expect(paneAccentColor(pane({ borderColor: undefined, customColor: '#123456' }))).toBe('#123456')
  })

  it('cae a gris si el tipo no tiene color', () => {
    const p = pane({ borderColor: 'transparent', customColor: undefined })
    expect(paneAccentColor({ ...p, aiType: 'nope' as PaneNode['aiType'] })).toBe('#888888')
  })
})
