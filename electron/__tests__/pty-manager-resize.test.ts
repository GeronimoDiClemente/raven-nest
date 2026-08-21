import { describe, it, expect, vi, beforeEach } from 'vitest'

// node-pty es nativo: no lo cargamos en test. El guard de resize no depende de
// spawn, así que inyectamos un pty falso en el mapa.
vi.mock('node-pty', () => ({ spawn: vi.fn() }))

import { PtyManager } from '../pty-manager'

function withFakePty() {
  const resize = vi.fn()
  const mgr = new PtyManager()
  ;(mgr as unknown as { ptys: Map<string, unknown> }).ptys.set('p1', { resize })
  return { mgr, resize }
}

describe('PtyManager.resize — no reenviar tamaños repetidos', () => {
  beforeEach(() => vi.clearAllMocks())

  // Bug visual: el renderer pide resize en CADA cambio de píxeles del contenedor
  // (ResizeObserver), aunque cols/rows no cambien. Cada reenvío llega al proceso
  // como un cambio de tamaño y las TUIs tipo Ink (Claude Code) repintan su
  // bloque estático: el banner de arranque se acumulaba decenas de veces.
  it('reenvía el primer tamaño y descarta los repetidos', () => {
    const { mgr, resize } = withFakePty()
    mgr.resize('p1', 80, 24)
    mgr.resize('p1', 80, 24)
    mgr.resize('p1', 80, 24)
    expect(resize).toHaveBeenCalledTimes(1)
    expect(resize).toHaveBeenCalledWith(80, 24)
  })

  it('reenvía cuando el tamaño cambia de verdad', () => {
    const { mgr, resize } = withFakePty()
    mgr.resize('p1', 80, 24)
    mgr.resize('p1', 100, 24)
    mgr.resize('p1', 100, 30)
    expect(resize).toHaveBeenCalledTimes(3)
  })

  it('vuelve a mandar el tamaño después de matar el pane', () => {
    const { mgr, resize } = withFakePty()
    mgr.resize('p1', 80, 24)
    mgr.kill('p1')
    ;(mgr as unknown as { ptys: Map<string, unknown> }).ptys.set('p1', { resize })
    mgr.resize('p1', 80, 24)
    expect(resize).toHaveBeenCalledTimes(2)
  })
})
