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

/**
 * Las rutas de claves no tenían limitador, y `publishWraps` es la operación más cara del
 * servicio: toma el advisory lock de la cuenta y el `for update` sobre `users` mientras
 * inserta. Medido en la tercera revisión: diez publishes concurrentes de una cuenta llevaron
 * un `POST /v1/sync/push` vacío de OTRA cuenta de 97ms a 2.640ms.
 *
 * Acá se prueba la política, no el cableado: que 12 por minuto por device es lo que aplica y
 * que el 13º recibe un `Retry-After` usable. El cableado en `http.ts` comparte exactamente el
 * mismo bloque que push y pull.
 */
describe('el limitador de las rutas de claves', () => {
  it('deja pasar 12 por minuto y corta el 13º con un Retry-After', () => {
    let ahora = 1_000_000
    const limiter = createRateLimiter({ limit: 12, windowMs: 60_000, now: () => ahora })

    for (let i = 1; i <= 12; i++) {
      expect(limiter.check('dev-1').ok, `la llamada ${i} tiene que pasar`).toBe(true)
    }
    const cortado = limiter.check('dev-1')
    expect(cortado.ok).toBe(false)
    if (!cortado.ok) {
      expect(cortado.retryAfterSeconds).toBeGreaterThan(0)
      expect(cortado.retryAfterSeconds).toBeLessThanOrEqual(60)
    }

    // Otro device no paga la cuota del primero: la clave es el device, no la cuenta ni la IP.
    expect(limiter.check('dev-2').ok).toBe(true)

    // Pasada la ventana, vuelve a abrir.
    ahora += 60_001
    expect(limiter.check('dev-1').ok).toBe(true)
  })

  // Los flujos reales: activar es una vez en la vida, autorizar es de a una máquina, y la
  // tarjeta lee el estado al abrir el overlay. Ninguno se acerca al límite.
  it('el flujo de activar y autorizar entra holgado', () => {
    let ahora = 2_000_000
    const limiter = createRateLimiter({ limit: 12, windowMs: 60_000, now: () => ahora })
    // enroll + GET estado + publish (activar) + GET estado + publish (autorizar) + GET
    for (let i = 0; i < 6; i++) expect(limiter.check('mac').ok).toBe(true)
  })
})
