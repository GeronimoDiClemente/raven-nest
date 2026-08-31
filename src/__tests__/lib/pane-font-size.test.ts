import { describe, it, expect } from 'vitest'
import { nextFontSize, FONT_SIZE_MIN, FONT_SIZE_MAX } from '../../lib/pane-font-size'

describe('nextFontSize — zoom de letra por pane', () => {
  it('sube y baja de a un paso', () => {
    expect(nextFontSize(13, 1)).toBe(14)
    expect(nextFontSize(13, -1)).toBe(12)
  })

  it('no pasa del maximo ni del minimo', () => {
    expect(nextFontSize(FONT_SIZE_MAX, 1)).toBe(FONT_SIZE_MAX)
    expect(nextFontSize(FONT_SIZE_MIN, -1)).toBe(FONT_SIZE_MIN)
  })

  it('parte del valor heredado cuando el pane no tiene el suyo', () => {
    // el caller pasa `pane.fontSize ?? global`
    expect(nextFontSize(16, 1)).toBe(17)
  })
})
