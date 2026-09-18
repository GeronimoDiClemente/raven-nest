import { describe, it, expect } from 'vitest'
import { siguientePaso, INCREMENTO_POR_LENTO, type RespuestaDePoll } from '../login-del-paquete'

const base = { intervaloMs: 2000, esperaAcumuladaMs: 0, venceEnMs: 600_000 }

describe('siguientePaso', () => {
  it('mientras el usuario no aprueba, espera el intervalo', () => {
    const r = siguientePaso({ status: 'authorization_pending' }, base)
    expect(r).toEqual({ accion: 'reintentar', esperarMs: 2000, intervaloMs: 2000 })
  })

  it('cuando aprueba, devuelve el token', () => {
    const resp: RespuestaDePoll = { status: 'linked', token: 'nmk_x', deviceId: 'd1' }
    expect(siguientePaso(resp, base)).toEqual({ accion: 'listo', token: 'nmk_x', deviceId: 'd1' })
  })

  it('si el servidor dice que va muy rápido, ESPACIA en vez de seguir igual', () => {
    // Sin esto el cliente golpea al mismo ritmo que le acaban de rechazar, y el servidor
    // termina gastando una consulta a la base por vuelta para contestar siempre lo mismo.
    const r = siguientePaso({ status: 'slow_down' }, base)
    expect(r).toEqual({ accion: 'reintentar', esperarMs: 2000 + INCREMENTO_POR_LENTO, intervaloMs: 2000 + INCREMENTO_POR_LENTO })
  })

  it('el intervalo espaciado se conserva para las vueltas siguientes', () => {
    const espaciado = siguientePaso({ status: 'slow_down' }, base)
    if (espaciado.accion !== 'reintentar') throw new Error('debería reintentar')
    const luego = siguientePaso({ status: 'authorization_pending' }, { ...base, intervaloMs: espaciado.intervaloMs })
    expect(luego).toMatchObject({ esperarMs: 2000 + INCREMENTO_POR_LENTO })
  })

  it('vencido corta, y lo dice con un motivo que se puede mostrar', () => {
    expect(siguientePaso({ status: 'expired' }, base)).toEqual({ accion: 'cortar', motivo: 'vencido' })
  })

  it('rechazado corta con el detalle del servidor', () => {
    const r = siguientePaso({ status: 'denied', error: 'not_in_beta' }, base)
    expect(r).toEqual({ accion: 'cortar', motivo: 'rechazado', detalle: 'not_in_beta' })
  })

  it('corta solo cuando se pasó de la vigencia, sin esperar que el servidor lo diga', () => {
    // El servidor puede no contestar nunca. Un `login` que espera para siempre es peor que
    // uno que falla: el usuario no sabe si sigue sirviendo dejar la terminal abierta.
    const r = siguientePaso({ status: 'authorization_pending' }, { ...base, esperaAcumuladaMs: 600_000 })
    expect(r).toEqual({ accion: 'cortar', motivo: 'vencido' })
  })

  it('un error de red no corta: se reintenta, porque el código sigue vivo', () => {
    const r = siguientePaso({ status: 'sin-respuesta' }, base)
    expect(r.accion).toBe('reintentar')
  })

  it('pero los errores de red seguidos también respetan la vigencia', () => {
    const r = siguientePaso({ status: 'sin-respuesta' }, { ...base, esperaAcumuladaMs: 600_001 })
    expect(r).toEqual({ accion: 'cortar', motivo: 'vencido' })
  })

  it('una respuesta que no entiende se trata como error de red, no como éxito', () => {
    // Un servidor viejo, un proxy que devuelve HTML, una versión nueva del protocolo: lo
    // único que NO puede pasar es que se interprete como token.
    const r = siguientePaso({ status: 'algo-que-no-existe' } as unknown as RespuestaDePoll, base)
    expect(r.accion).toBe('reintentar')
  })
})

describe('el orden entre "ya venció" y "ya está"', () => {
  it('un token que llega justo al vencer NO se tira', () => {
    // El servidor ya lo emitió y ya marcó el pedido consumido: descartarlo acá deja al
    // usuario sin credencial y sin forma de volver a pedir la misma. El corte por vigencia
    // tiene que ir DESPUÉS de los estados terminales.
    const r = siguientePaso(
      { status: 'linked', token: 'nmk_justo', deviceId: 'd9' },
      { intervaloMs: 2000, esperaAcumuladaMs: 600_000, venceEnMs: 600_000 },
    )
    expect(r).toEqual({ accion: 'listo', token: 'nmk_justo', deviceId: 'd9' })
  })

  it('un rechazo tardío se informa como rechazo, no como vencimiento', () => {
    const r = siguientePaso(
      { status: 'denied', error: 'device_limit' },
      { intervaloMs: 2000, esperaAcumuladaMs: 999_999, venceEnMs: 600_000 },
    )
    expect(r).toMatchObject({ motivo: 'rechazado', detalle: 'device_limit' })
  })
})
