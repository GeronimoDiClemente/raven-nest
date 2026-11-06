// La salida de un pane sin foco se junta y llega a xterm a ~10 Hz; la del enfocado, directo.
import { describe, it, expect } from 'vitest'
import { crearEscrituraDiferida } from '../../lib/escritura-diferida'

function relojFalso() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { cb: () => void; at: number }>()
  const escrituras: string[] = []
  const deps = {
    escribir: (d: string) => { escrituras.push(d) },
    setTimer: (cb: () => void, ms: number) => { const id = nextId++; timers.set(id, { cb, at: now + ms }); return id },
    clearTimer: (id: number) => { timers.delete(id) },
  }
  const avanzar = (ms: number) => {
    const fin = now + ms
    for (;;) {
      const proximo = [...timers.entries()].filter(([, t]) => t.at <= fin).sort((a, b) => a[1].at - b[1].at)[0]
      if (!proximo) break
      timers.delete(proximo[0])
      now = proximo[1].at
      proximo[1].cb()
    }
    now = fin
  }
  return { deps, escrituras, avanzar, timersVivos: () => timers.size }
}

describe('crearEscrituraDiferida', () => {
  it('enfocado: cada trozo pasa directo, sin timers', () => {
    const r = relojFalso()
    const e = crearEscrituraDiferida(r.deps, true)
    e.escribir('a'); e.escribir('b')
    expect(r.escrituras).toEqual(['a', 'b'])
    expect(r.timersVivos()).toBe(0)
  })

  it('sin foco: 20 frames por segundo de un agente llegan a xterm como 10 lotes', () => {
    const r = relojFalso()
    const e = crearEscrituraDiferida(r.deps, false)
    for (let i = 0; i < 20; i++) { e.escribir(`f${i};`); r.avanzar(50) }
    expect(r.escrituras.length).toBe(10)
    expect(r.escrituras.join('')).toBe(Array.from({ length: 20 }, (_, i) => `f${i};`).join(''))
  })

  it('con salida continua el lote sale igual a los 100ms: el timer no se re-arma con cada trozo', () => {
    const r = relojFalso()
    const e = crearEscrituraDiferida(r.deps, false)
    for (let i = 0; i < 9; i++) { e.escribir('x'); r.avanzar(10) }
    expect(r.escrituras).toEqual([])
    r.avanzar(10)
    expect(r.escrituras).toEqual(['xxxxxxxxx'])
  })

  it('al enfocar vacía lo pendiente en el acto y lo nuevo va detrás, en orden', () => {
    const r = relojFalso()
    const e = crearEscrituraDiferida(r.deps, false)
    e.escribir('1'); e.escribir('2')
    e.setInmediato(true)
    expect(r.escrituras).toEqual(['12'])
    e.escribir('3')
    expect(r.escrituras).toEqual(['12', '3'])
    expect(r.timersVivos()).toBe(0)
  })

  it('al perder el foco empieza a juntar', () => {
    const r = relojFalso()
    const e = crearEscrituraDiferida(r.deps, true)
    e.setInmediato(false)
    e.escribir('a'); e.escribir('b')
    expect(r.escrituras).toEqual([])
    r.avanzar(100)
    expect(r.escrituras).toEqual(['ab'])
  })

  it('stop descarta lo pendiente y no escribe nada más', () => {
    const r = relojFalso()
    const e = crearEscrituraDiferida(r.deps, false)
    e.escribir('a')
    e.stop()
    r.avanzar(500)
    e.escribir('b')
    e.setInmediato(true)
    expect(r.escrituras).toEqual([])
    expect(r.timersVivos()).toBe(0)
  })
})
