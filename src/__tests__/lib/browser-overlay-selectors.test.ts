// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { overlaySelectorFor } from '../../lib/browser-overlay-selectors'

describe('overlaySelectorFor — qué colapsa el WebContentsView', () => {
  it('sin zoom, el backdrop del zoom de otro pane colapsa el browser', () => {
    expect(overlaySelectorFor(false)).toContain('.zoom-backdrop')
  })

  it('con el pane zoomeado, su propio backdrop no lo colapsa', () => {
    expect(overlaySelectorFor(true)).not.toContain('.zoom-backdrop')
  })

  // Bug: la exención del zoom salteaba la lista ENTERA, así que un browser
  // zoomeado tapaba cualquier modal abierto encima (la capa nativa va por
  // arriba del DOM): el modal quedaba invisible e inclickeable.
  it('con el pane zoomeado, los modales y popovers lo siguen colapsando', () => {
    const sel = overlaySelectorFor(true)
    for (const s of ['.global-search-overlay', '.upgrade-modal', '.cmd-overlay', '.teams-workspace', '.user-menu-popover']) {
      expect(sel).toContain(s)
    }
  })

  it('es un selector CSS válido en ambos modos', () => {
    for (const zoomed of [true, false]) {
      expect(() => document.querySelector(overlaySelectorFor(zoomed))).not.toThrow()
    }
  })
})
