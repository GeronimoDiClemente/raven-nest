import { describe, it, expect, vi } from 'vitest'
import { parsearTablaDeProcesos, crearSnapshotDeProcesos } from '../ps-snapshot'

describe('parsearTablaDeProcesos', () => {
  it('arma padre → hijos desde la salida de `ps -A -o ppid,pid`', () => {
    const m = parsearTablaDeProcesos(' PPID   PID\n    1  100\n  100  200\n  100  201\n  200  300\n')
    expect(m.get(1)).toEqual([100])
    expect(m.get(100)).toEqual([200, 201])
    expect(m.get(200)).toEqual([300])
  })

  it('ignora el encabezado y las líneas que no son dos números', () => {
    const m = parsearTablaDeProcesos('PPID PID\nbasura\n\n   1   2\n  x  y\n')
    expect(m.get(1)).toEqual([2])
    expect(m.size).toBe(1)
  })

  it('descarta un proceso que se dice hijo de sí mismo', () => {
    // Un PPID == PID haría que walkTree se colgara si no hubiera guarda aguas abajo;
    // no hay razón para meterlo en el mapa.
    const m = parsearTablaDeProcesos(' PPID PID\n  5   5\n  1   9\n')
    expect(m.get(5)).toBeUndefined()
    expect(m.get(1)).toEqual([9])
  })

  it('tolera espacios de más y tabs', () => {
    const m = parsearTablaDeProcesos('\t42\t\t7\n')
    expect(m.get(42)).toEqual([7])
  })
})

describe('crearSnapshotDeProcesos', () => {
  const tabla = ' PPID PID\n 1 10\n 10 20\n 20 30\n 1 40\n'

  it('un solo `ps` sirve a varias consultas dentro del TTL', async () => {
    const correrPs = vi.fn(async () => tabla)
    let ahora = 1000
    const snap = crearSnapshotDeProcesos({ correrPs, now: () => ahora, ttlMs: 1500 })
    // El orden del recorrido no es parte del contrato: los llamadores arman Sets.
    expect((await snap.arbolDe(10)).sort((a, b) => a - b)).toEqual([10, 20, 30])
    ahora = 2000
    expect((await snap.arbolDe(1)).sort((a, b) => a - b)).toEqual([1, 10, 20, 30, 40])
    expect(correrPs).toHaveBeenCalledTimes(1)
  })

  it('pasado el TTL vuelve a mirar la tabla', async () => {
    const correrPs = vi.fn(async () => tabla)
    let ahora = 1000
    const snap = crearSnapshotDeProcesos({ correrPs, now: () => ahora, ttlMs: 1500 })
    await snap.arbolDe(10)
    ahora = 2600
    await snap.arbolDe(10)
    expect(correrPs).toHaveBeenCalledTimes(2)
  })

  it('doce consultas simultáneas comparten UN solo `ps`', async () => {
    // Es el caso que motivó esto: el poll de puertos pedía el árbol de cada pane
    // por separado y cada pedido spawneaba su propio `ps -A` sobre toda la tabla.
    let resolver: ((v: string) => void) | null = null
    const correrPs = vi.fn(() => new Promise<string>((r) => { resolver = r }))
    const snap = crearSnapshotDeProcesos({ correrPs, now: () => 1000, ttlMs: 1500 })
    const pedidos = Promise.all(Array.from({ length: 12 }, () => snap.arbolDe(10)))
    resolver!(tabla)
    const r = await pedidos
    expect(correrPs).toHaveBeenCalledTimes(1)
    expect(r.every((t) => t.join() === '10,20,30')).toBe(true)
  })

  it('un pid que no está en la tabla se devuelve solo, sin inventar hijos', () => {
    const snap = crearSnapshotDeProcesos({ correrPs: async () => tabla, now: () => 1, ttlMs: 1500 })
    return expect(snap.arbolDe(9999)).resolves.toEqual([9999])
  })

  it('si `ps` falla devuelve el pid solo y no rompe', async () => {
    const snap = crearSnapshotDeProcesos({
      correrPs: async () => { throw new Error('ps: command not found') },
      now: () => 1, ttlMs: 1500,
    })
    expect(await snap.arbolDe(10)).toEqual([10])
  })

  it('un ciclo de PPIDs no lo cuelga', async () => {
    const snap = crearSnapshotDeProcesos({
      correrPs: async () => ' PPID PID\n 10 20\n 20 10\n', now: () => 1, ttlMs: 1500,
    })
    expect((await snap.arbolDe(10)).sort()).toEqual([10, 20])
  })
})
