import { describe, it, expect } from 'vitest'
import { startIntervaloVisible } from '../../lib/intervalo-visible'

/** Reloj falso: los timers no corren solos, los corre el test. */
function banco(seVeAlArrancar = true) {
  let siguienteId = 1
  const timers = new Map<number, { cb: () => void; ms: number }>()
  let seVe = seVeAlArrancar
  const oyentes = new Set<() => void>()
  let ticks = 0

  return {
    get ticks() { return ticks },
    get timersVivos() { return timers.size },
    get oyentesVivos() { return oyentes.size },
    vencerTimers() {
      for (const [id, t] of [...timers]) { timers.delete(id); t.cb() }
    },
    cambiarVisibilidad(v: boolean) { seVe = v; for (const o of oyentes) o() },
    deps: {
      tick: () => { ticks++ },
      setTimer: (cb: () => void, ms: number) => { const id = siguienteId++; timers.set(id, { cb, ms }); return id },
      clearTimer: (id: number) => { timers.delete(id) },
      alCambiarVisibilidad: (cb: () => void) => { oyentes.add(cb); return () => oyentes.delete(cb) },
      seVe: () => seVe,
      ms: 5000,
    },
  }
}

describe('startIntervaloVisible', () => {
  it('tickea una vez al arrancar si la ventana se ve', () => {
    const b = banco(true)
    startIntervaloVisible(b.deps)
    expect(b.ticks).toBe(1)
  })

  it('no tickea NI agenda nada si arranca oculta', () => {
    const b = banco(false)
    startIntervaloVisible(b.deps)
    expect(b.ticks).toBe(0)
    expect(b.timersVivos).toBe(0)
  })

  it('mientras se ve, tickea en cada vencimiento', () => {
    const b = banco(true)
    startIntervaloVisible(b.deps)
    b.vencerTimers()
    b.vencerTimers()
    expect(b.ticks).toBe(3)
  })

  it('al ocultarse no queda NINGÚN timer pendiente', () => {
    const b = banco(true)
    startIntervaloVisible(b.deps)
    b.cambiarVisibilidad(false)
    expect(b.timersVivos).toBe(0)
  })

  it('oculta no tickea aunque venzan timers viejos', () => {
    const b = banco(true)
    startIntervaloVisible(b.deps)
    b.cambiarVisibilidad(false)
    const antes = b.ticks
    b.vencerTimers()
    expect(b.ticks).toBe(antes)
  })

  it('al volver a verse tickea EN EL ACTO, sin esperar el intervalo', () => {
    const b = banco(true)
    startIntervaloVisible(b.deps)
    b.cambiarVisibilidad(false)
    const antes = b.ticks
    b.cambiarVisibilidad(true)
    expect(b.ticks).toBe(antes + 1)
  })

  it('un aviso de visibilidad que no cambia nada no re-agenda ni duplica timers', () => {
    const b = banco(true)
    startIntervaloVisible(b.deps)
    const antes = b.ticks
    b.cambiarVisibilidad(true)
    expect(b.ticks).toBe(antes)
    expect(b.timersVivos).toBe(1)
  })

  it('stop() limpia el timer y se desuscribe', () => {
    const b = banco(true)
    const s = startIntervaloVisible(b.deps)
    s.stop()
    expect(b.timersVivos).toBe(0)
    expect(b.oyentesVivos).toBe(0)
  })

  it('después de stop() un cambio de visibilidad no revive nada', () => {
    const b = banco(true)
    const s = startIntervaloVisible(b.deps)
    const antes = b.ticks
    s.stop()
    b.cambiarVisibilidad(false)
    b.cambiarVisibilidad(true)
    expect(b.ticks).toBe(antes)
    expect(b.timersVivos).toBe(0)
  })

  it('agenda con el intervalo que le pasaron', () => {
    const b = banco(true)
    startIntervaloVisible({ ...b.deps, ms: 1234 })
    b.vencerTimers()
    expect(b.ticks).toBe(2)
  })
})
