import { describe, it, expect } from 'vitest'
import { startRepositionScheduler } from '../lib/reposition-scheduler'

/**
 * Un reloj falso con las cuatro dependencias que el scheduler usa, para poder
 * avanzar frames y timers a mano y CONTAR cuántos pidió.
 *
 * El número que importa es `rafCalls`: cada frame pedido obliga al compositor de
 * Chromium a entregar uno, y eso es lo que mantiene despierta la GPU y el
 * WindowServer de macOS con la app quieta. Medido el 2026-09-14 sobre la app real:
 * ~12% de GPU helper y ~21% de WindowServer.
 */
function relojFalso(idleMs = 100) {
  let now = 0
  let nextId = 1
  const frames = new Map<number, (now: number) => void>()
  const timers = new Map<number, { cb: () => void; at: number }>()
  let checks = 0
  let rafCalls = 0

  const deps = {
    check: () => { checks++ },
    raf: (cb: (now: number) => void) => {
      rafCalls++
      const id = nextId++
      frames.set(id, cb)
      return id
    },
    cancelRaf: (id: number) => { frames.delete(id) },
    setTimer: (cb: () => void, ms: number) => {
      const id = nextId++
      timers.set(id, { cb, at: now + ms })
      return id
    },
    clearTimer: (id: number) => { timers.delete(id) },
    idleMs,
  }

  return {
    deps,
    get checks() { return checks },
    get rafCalls() { return rafCalls },
    get framesPendientes() { return frames.size },
    get timersPendientes() { return timers.size },
    /** Avanza `ms` disparando los frames a 60fps y los timers que vencen. */
    avanzar(ms: number) {
      const hasta = now + ms
      while (now < hasta) {
        now = Math.min(now + 16, hasta)
        for (const [id, t] of [...timers]) {
          if (t.at <= now) { timers.delete(id); t.cb() }
        }
        for (const [id, cb] of [...frames]) {
          frames.delete(id); cb(now)
        }
      }
    },
  }
}

describe('scheduler de reposición del browser', () => {
  it('con el pane quieto no pide NI UN frame en un segundo entero', () => {
    const r = relojFalso()
    startRepositionScheduler(r.deps)

    r.avanzar(1000)

    expect(r.rafCalls).toBe(0)
  })

  it('con el pane quieto igual mide, ~10 veces por segundo', () => {
    const r = relojFalso(100)
    startRepositionScheduler(r.deps)

    r.avanzar(1000)

    expect(r.checks).toBeGreaterThanOrEqual(9)
    expect(r.checks).toBeLessThanOrEqual(11)
  })

  it('mientras algo mueve el pane sigue al DOM frame a frame', () => {
    const r = relojFalso()
    const s = startRepositionScheduler(r.deps)

    s.setMoving(true)
    r.avanzar(160) // 10 frames a 16ms

    expect(r.checks).toBeGreaterThanOrEqual(9)
  })

  it('al dejar de moverse vuelve a no pedir frames', () => {
    const r = relojFalso()
    const s = startRepositionScheduler(r.deps)

    s.setMoving(true)
    r.avanzar(160)
    const durante = r.rafCalls
    s.setMoving(false)
    r.avanzar(1000)

    expect(r.rafCalls).toBe(durante)
    expect(r.framesPendientes).toBe(0)
  })

  it('stop no deja nada agendado, ni frame ni timer', () => {
    const r = relojFalso()
    const s = startRepositionScheduler(r.deps)
    r.avanzar(200)

    s.stop()

    expect(r.framesPendientes).toBe(0)
    expect(r.timersPendientes).toBe(0)
    const antes = r.checks
    r.avanzar(1000)
    expect(r.checks).toBe(antes)
  })
})
