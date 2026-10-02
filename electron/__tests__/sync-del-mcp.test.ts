// El sync del MCP del paquete portátil (§6.2 del spec): bajar al arrancar, subir después de
// cada escritura, SIN daemon de fondo — y sin quedarse con el candado.
import { describe, it, expect, vi } from 'vitest'
import { SyncDelMcp, type SincronizadorSoltable } from '../sync-del-mcp'

function falso(over: Partial<SincronizadorSoltable> = {}) {
  const orden: string[] = []
  const s: SincronizadorSoltable = {
    pull: vi.fn(async () => { orden.push('pull') }),
    push: vi.fn(async () => { orden.push('push') }),
    stop: vi.fn(() => { orden.push('stop') }),
    ...over,
  }
  return { s, orden }
}

describe('SyncDelMcp', () => {
  it('sin cuenta no toca la red', async () => {
    const { s } = falso()
    const sync = new SyncDelMcp(s, false)
    sync.alArrancar()
    sync.trasEscribir()
    await sync.enCurso()
    expect(s.pull).not.toHaveBeenCalled()
    expect(s.push).not.toHaveBeenCalled()
  })

  it('al arrancar baja, y suelta el candado al terminar', async () => {
    const { s, orden } = falso()
    const sync = new SyncDelMcp(s, true)
    sync.alArrancar()
    await sync.enCurso()
    expect(orden).toEqual(['pull', 'stop'])
  })

  it('después de escribir sube, y suelta el candado', async () => {
    // Soltarlo es lo que importa: el MCP vive lo que dure la sesión del editor, y si se
    // quedara con el candado, Nest abierto en esta máquina no podría sincronizar nunca.
    const { s, orden } = falso()
    const sync = new SyncDelMcp(s, true)
    sync.trasEscribir()
    await sync.enCurso()
    expect(orden).toEqual(['push', 'stop'])
  })

  it('nunca corre dos operaciones a la vez: van en fila', async () => {
    let enVuelo = 0
    let maximo = 0
    const lento = async () => {
      enVuelo++; maximo = Math.max(maximo, enVuelo)
      await new Promise((r) => setTimeout(r, 5))
      enVuelo--
    }
    const { s } = falso({ pull: vi.fn(lento), push: vi.fn(lento) })
    const sync = new SyncDelMcp(s, true)
    sync.alArrancar()
    sync.trasEscribir()
    await sync.enCurso()
    expect(maximo).toBe(1)
  })

  it('varias escrituras mientras se sube se juntan en UN push más, no en uno por escritura', async () => {
    let soltar!: () => void
    const primero = new Promise<void>((r) => { soltar = r })
    const push = vi.fn()
      .mockImplementationOnce(() => primero)
      .mockImplementation(async () => {})
    const { s } = falso({ push })
    const sync = new SyncDelMcp(s, true)
    sync.trasEscribir()
    // Que el primer push arranque de verdad antes de las otras escrituras.
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    sync.trasEscribir()
    sync.trasEscribir()
    sync.trasEscribir()
    soltar()
    await sync.enCurso()
    // El primero, más uno que levanta todo lo que se escribió mientras volaba.
    expect(push).toHaveBeenCalledTimes(2)
  })

  it('escrituras que llegan antes de que el push arranque viajan en ese mismo push', async () => {
    const { s } = falso()
    const sync = new SyncDelMcp(s, true)
    sync.trasEscribir()
    sync.trasEscribir()
    sync.trasEscribir()
    await sync.enCurso()
    expect(s.push).toHaveBeenCalledTimes(1)
  })

  it('un push que falla no rompe al siguiente ni sube como excepción', async () => {
    const push = vi.fn()
      .mockRejectedValueOnce(new Error('sin red'))
      .mockResolvedValue(undefined)
    const { s } = falso({ push })
    const sync = new SyncDelMcp(s, true)
    sync.trasEscribir()
    await sync.enCurso()
    sync.trasEscribir()
    await sync.enCurso()
    expect(push).toHaveBeenCalledTimes(2)
    // Y suelta el candado aunque haya fallado.
    expect(s.stop).toHaveBeenCalledTimes(2)
  })
})
