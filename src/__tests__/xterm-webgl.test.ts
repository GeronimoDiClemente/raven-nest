import { describe, it, expect, vi } from 'vitest'
import { activarWebgl, type AddonWebglComoSea, type TerminalComoSea } from '../lib/xterm-webgl'

function terminalFalso() {
  const cargados: unknown[] = []
  const term: TerminalComoSea = { loadAddon: (a) => { cargados.push(a) } }
  return { term, cargados }
}

function addonFalso() {
  let alPerderContexto: (() => void) | null = null
  const addon: AddonWebglComoSea = {
    dispose: vi.fn(),
    onContextLoss: (cb) => { alPerderContexto = cb },
    activate: vi.fn(),
  }
  return { addon, perderContexto: () => alPerderContexto?.() }
}

describe('activarWebgl', () => {
  it('engancha el addon cuando WebGL está disponible', () => {
    const { term, cargados } = terminalFalso()
    const { addon } = addonFalso()
    const r = activarWebgl(term, { crearAddon: () => addon })
    expect(r.activo).toBe(true)
    expect(cargados).toEqual([addon])
  })

  it('si crear el addon tira, se queda en DOM sin romper', () => {
    const { term, cargados } = terminalFalso()
    const r = activarWebgl(term, { crearAddon: () => { throw new Error('sin WebGL2') } })
    expect(r.activo).toBe(false)
    expect(cargados).toEqual([])
  })

  it('si loadAddon tira al activar, descarta el addon y se queda en DOM', () => {
    const { addon } = addonFalso()
    const term: TerminalComoSea = { loadAddon: () => { throw new Error('no se pudo crear el contexto') } }
    const r = activarWebgl(term, { crearAddon: () => addon })
    expect(r.activo).toBe(false)
    expect(addon.dispose).toHaveBeenCalledTimes(1)
  })

  it('al perder el contexto descarta el addon y cae al DOM', () => {
    const { term } = terminalFalso()
    const { addon, perderContexto } = addonFalso()
    const r = activarWebgl(term, { crearAddon: () => addon })
    perderContexto()
    expect(addon.dispose).toHaveBeenCalledTimes(1)
    expect(r.activo).toBe(false)
  })

  it('perder el contexto y después desmontar NO descarta dos veces', () => {
    const { term } = terminalFalso()
    const { addon, perderContexto } = addonFalso()
    const r = activarWebgl(term, { crearAddon: () => addon })
    perderContexto()
    r.dispose()
    expect(addon.dispose).toHaveBeenCalledTimes(1)
  })

  it('desmontar descarta el addon', () => {
    const { term } = terminalFalso()
    const { addon } = addonFalso()
    const r = activarWebgl(term, { crearAddon: () => addon })
    r.dispose()
    expect(addon.dispose).toHaveBeenCalledTimes(1)
    expect(r.activo).toBe(false)
  })

  it('si el addon tira al descartarse, no propaga', () => {
    const { term } = terminalFalso()
    const { addon } = addonFalso()
    ;(addon.dispose as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('ya estaba muerto') })
    const r = activarWebgl(term, { crearAddon: () => addon })
    expect(() => r.dispose()).not.toThrow()
  })
})
