import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

/** El manager espera a que el tamaño se asiente antes de tocar el pty. */
const settle = () => vi.advanceTimersByTime(300)

describe('PtyManager.resize — lo que llega al proceso', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  // Bug visual: el renderer pide resize en CADA cambio de píxeles del contenedor
  // (ResizeObserver), aunque cols/rows no cambien. Cada reenvío llega al proceso
  // como un cambio de tamaño y las TUIs tipo Ink (Claude Code) repintan su
  // bloque estático: el banner de arranque se acumulaba decenas de veces.
  it('reenvía el primer tamaño y descarta los repetidos', () => {
    const { mgr, resize } = withFakePty()
    mgr.resize('p1', 80, 24)
    mgr.resize('p1', 80, 24)
    mgr.resize('p1', 80, 24)
    settle()
    expect(resize).toHaveBeenCalledTimes(1)
    expect(resize).toHaveBeenCalledWith(80, 24)
  })

  it('reenvía cuando el tamaño cambia de verdad y se asienta', () => {
    const { mgr, resize } = withFakePty()
    mgr.resize('p1', 80, 24)
    settle()
    mgr.resize('p1', 100, 24)
    settle()
    mgr.resize('p1', 100, 30)
    settle()
    expect(resize).toHaveBeenCalledTimes(3)
  })

  it('vuelve a mandar el tamaño después de matar el pane', () => {
    const { mgr, resize } = withFakePty()
    mgr.resize('p1', 80, 24)
    settle()
    mgr.kill('p1')
    ;(mgr as unknown as { ptys: Map<string, unknown> }).ptys.set('p1', { resize })
    mgr.resize('p1', 80, 24)
    settle()
    expect(resize).toHaveBeenCalledTimes(2)
  })

  // Bug visual: arrastrar o redimensionar un pane lo hace pasar por decenas de
  // tamaños REALES distintos (no repetidos, así que el guard de arriba no
  // aplica). Cada uno le llega al proceso como un cambio de tamaño y la TUI
  // repinta: el banner se multiplicaba, cada copia con un ancho distinto.
  it('un drag con muchos tamaños intermedios manda UN solo resize, el final', () => {
    const { mgr, resize } = withFakePty()
    mgr.resize('p1', 120, 30)
    mgr.resize('p1', 100, 30)
    mgr.resize('p1', 80, 30)
    mgr.resize('p1', 60, 30)
    expect(resize).not.toHaveBeenCalled()

    settle()
    expect(resize).toHaveBeenCalledTimes(1)
    expect(resize).toHaveBeenCalledWith(60, 30)
  })

  it('si el tamaño vuelve al que ya tenía el pty, no manda nada', () => {
    const { mgr, resize } = withFakePty()
    mgr.resize('p1', 80, 24)
    settle()
    expect(resize).toHaveBeenCalledTimes(1)

    // pasa por otros tamaños y vuelve al original antes de asentarse
    mgr.resize('p1', 60, 24)
    mgr.resize('p1', 80, 24)
    settle()
    expect(resize).toHaveBeenCalledTimes(1)
  })

  it('matar el pane no deja timers pendientes que resuciten el resize', () => {
    const { mgr, resize } = withFakePty()
    mgr.resize('p1', 80, 24)
    mgr.kill('p1')
    settle()
    expect(resize).not.toHaveBeenCalled()
  })
})

describe('PtyManager.resize — descartar tamaños degenerados', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  // Un panel colapsado a su minSize (8% del ancho) mide ~15 columnas, y el
  // reflow deja formas de 6 filas. No son tamaños de trabajo: aplicarlos hace
  // que la TUI repinte su banner en una tira vertical de 4 caracteres, y esa
  // basura queda en el scrollback para siempre. Preferimos que el pty conserve
  // el último tamaño usable a corromper la sesión.
  it('ignora un ancho de panel colapsado', () => {
    const { mgr, resize } = withFakePty()
    mgr.resize('p1', 15, 30)
    settle()
    expect(resize).not.toHaveBeenCalled()
  })

  it('ignora un alto degenerado del reflow', () => {
    const { mgr, resize } = withFakePty()
    mgr.resize('p1', 120, 4)
    settle()
    expect(resize).not.toHaveBeenCalled()
  })

  it('un tamaño chico pero usable sí pasa', () => {
    const { mgr, resize } = withFakePty()
    mgr.resize('p1', 40, 10)
    settle()
    expect(resize).toHaveBeenCalledWith(40, 10)
  })

  it('el tamaño degenerado no pisa al último bueno', () => {
    const { mgr, resize } = withFakePty()
    mgr.resize('p1', 100, 30)
    settle()
    mgr.resize('p1', 15, 30)
    settle()
    // vuelve al mismo tamaño bueno: como el pty nunca dejó de tenerlo, no hay que remandarlo
    mgr.resize('p1', 100, 30)
    settle()
    expect(resize).toHaveBeenCalledTimes(1)
  })
})
