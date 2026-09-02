import { describe, it, expect } from 'vitest'
import { createRateLimiter } from '../src/rate-limit'

describe('createRateLimiter', () => {
  it('deja pasar hasta el limite y frena el siguiente', () => {
    let clock = 1_000_000
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => clock })

    expect(rl.check('device-a').ok).toBe(true)
    expect(rl.check('device-a').ok).toBe(true)
    expect(rl.check('device-a').ok).toBe(true)

    const blocked = rl.check('device-a')
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBe(60)
  })

  it('cuenta cada device por separado', () => {
    let clock = 1_000_000
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => clock })

    expect(rl.check('device-a').ok).toBe(true)
    expect(rl.check('device-b').ok).toBe(true)
    expect(rl.check('device-a').ok).toBe(false)
  })

  it('vuelve a dejar pasar cuando la ventana termina', () => {
    let clock = 1_000_000
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => clock })

    expect(rl.check('device-a').ok).toBe(true)
    expect(rl.check('device-a').ok).toBe(false)
    clock += 60_001
    expect(rl.check('device-a').ok).toBe(true)
  })

  it('purga una entrada vencida cuando pasa una ventana entera', () => {
    // size() existe solo para poder observar esto: sin el, no hay forma de distinguir
    // "la entrada vencida ya no cuenta para el limite" (que ya probaba el test de arriba)
    // de "la entrada vencida sigue viva en el Map para siempre" (la fuga real).
    let clock = 1_000_000
    const rl = createRateLimiter({ limit: 5, windowMs: 60_000, now: () => clock })

    expect(rl.check('device-a').ok).toBe(true)
    expect(rl.size()).toBe(1)

    clock += 60_001
    // device-b es el que dispara la purga perezosa como efecto colateral de su propio check.
    expect(rl.check('device-b').ok).toBe(true)

    // la entrada de device-a, ya vencida, fue barrida en vez de quedar retenida para siempre.
    expect(rl.size()).toBe(1)
  })

  it('la purga no borra ni reinicia una ventana que todavia esta viva', () => {
    let clock = 1_000_000
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => clock })

    clock += 50_000
    expect(rl.check('device-a').ok).toBe(true) // cuenta 1, ventana arranca en 1_050_000
    expect(rl.check('device-a').ok).toBe(true) // cuenta 2

    clock += 5_000
    expect(rl.check('device-b').ok).toBe(true) // cuenta 1, ventana arranca en 1_055_000

    clock += 6_000 // pasaron 61_000 desde la creacion: dispara la purga
    expect(rl.check('device-c').ok).toBe(true) // gatilla la purga como efecto colateral

    // ninguno de los dos devices activos se perdio: sus ventanas (11s y 6s de antiguedad)
    // siguen dentro del windowMs de 60s, asi que la purga no debia tocarlas.
    expect(rl.size()).toBe(3)

    // y la cuenta de device-a no se reinicio: si la purga la hubiera borrado y check() la
    // hubiera recreado de cero, este tercer check volveria a dar ok (cuenta 1 de 3) en vez
    // de agotar el limite en el cuarto.
    expect(rl.check('device-a').ok).toBe(true) // cuenta 3 de 3 -> al limite
    expect(rl.check('device-a').ok).toBe(false) // cuenta 4 de 3 -> bloqueado
  })
})
