import { describe, it, expect } from 'vitest'
import { minimapEnabledFor, MINIMAP_MIN_PANE_WIDTH } from '../../lib/editor-minimap'

describe('minimapEnabledFor — el minimap sigue al ancho del pane', () => {
  it('un pane ancho (único, o zoomeado con el zoom de Nest) lo muestra', () => {
    expect(minimapEnabledFor(1600)).toBe(true)
  })

  it('dos panes en paralelo en una pantalla normal lo muestran', () => {
    expect(minimapEnabledFor(1920 / 2)).toBe(true)
  })

  it('tres o más en paralelo lo esconden: ahí el minimap es puro ruido', () => {
    expect(minimapEnabledFor(1920 / 3)).toBe(false)
  })

  it('un pane recién montado (ancho 0, sin medir todavía) no lo muestra', () => {
    expect(minimapEnabledFor(0)).toBe(false)
  })

  it('el umbral es inclusivo', () => {
    expect(minimapEnabledFor(MINIMAP_MIN_PANE_WIDTH)).toBe(true)
    expect(minimapEnabledFor(MINIMAP_MIN_PANE_WIDTH - 1)).toBe(false)
  })
})
