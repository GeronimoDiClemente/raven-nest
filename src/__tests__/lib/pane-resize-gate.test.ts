import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  beginResizeSuppression,
  endResizeSuppression,
  isResizeSuppressed,
  onResizeSettled,
  resetResizeGate,
} from '../../lib/pane-resize-gate'

describe('pane-resize-gate — no mandar tamaños mientras el layout se mueve', () => {
  beforeEach(() => resetResizeGate())

  it('mientras hay un drag, los resizes quedan suprimidos', () => {
    expect(isResizeSuppressed()).toBe(false)
    beginResizeSuppression()
    expect(isResizeSuppressed()).toBe(true)
    endResizeSuppression()
    expect(isResizeSuppressed()).toBe(false)
  })

  it('avisa UNA vez cuando el layout se asienta', () => {
    const settled = vi.fn()
    onResizeSettled(settled)
    beginResizeSuppression()
    endResizeSuppression()
    expect(settled).toHaveBeenCalledTimes(1)
  })

  // Arrastrar un pane y soltar sobre un divisor pueden solaparse: el primero en
  // terminar no debe destapar al otro y dejar pasar tamaños intermedios.
  it('con supresiones solapadas, solo destapa la última', () => {
    const settled = vi.fn()
    onResizeSettled(settled)
    beginResizeSuppression()
    beginResizeSuppression()
    endResizeSuppression()
    expect(isResizeSuppressed()).toBe(true)
    expect(settled).not.toHaveBeenCalled()
    endResizeSuppression()
    expect(isResizeSuppressed()).toBe(false)
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('un end de más no rompe el contador ni dispara el aviso', () => {
    const settled = vi.fn()
    onResizeSettled(settled)
    endResizeSuppression()
    expect(isResizeSuppressed()).toBe(false)
    expect(settled).not.toHaveBeenCalled()
  })

  it('se puede desuscribir', () => {
    const settled = vi.fn()
    const off = onResizeSettled(settled)
    off()
    beginResizeSuppression()
    endResizeSuppression()
    expect(settled).not.toHaveBeenCalled()
  })
})
