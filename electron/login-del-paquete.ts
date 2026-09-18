// El bucle de espera de `nest-memory login`, sin reloj ni red adentro.
//
// La otra mitad de `server/src/link.ts`: la máquina que no puede abrir un navegador muestra
// un código, el usuario lo aprueba desde otra, y esta función decide qué hacer con cada
// respuesta mientras tanto. Es puro a propósito — el `login` de verdad es un `while` de cuatro
// líneas alrededor de esto, y todo lo que puede salir mal se prueba sin levantar nada.
//
// Dos decisiones que no son obvias y que los tests fijan:
//
// - **Un error de red no corta.** El código sigue vivo del otro lado, así que cortar por un
//   corte de wifi obligaría al usuario a volver a empezar por nada. Se reintenta.
// - **Lo que no se entiende se trata como error de red, nunca como éxito.** Un servidor viejo,
//   un proxy que devuelve HTML, una versión futura del protocolo: el modo de falla que hay que
//   evitar es guardar un token vacío y decirle al usuario que quedó conectado.

/** Lo que contesta `/v1/link/poll`, ya parseado, más el caso de que no haya contestado. */
export type RespuestaDePoll =
  | { status: 'authorization_pending' }
  | { status: 'slow_down' }
  | { status: 'expired' }
  | { status: 'denied'; error?: string }
  | { status: 'linked'; token: string; deviceId: string }
  /** No hubo respuesta usable: se cayó la red, o vino algo que no es de este protocolo. */
  | { status: 'sin-respuesta' }

export interface EstadoDeLogin {
  /** Cada cuánto preguntar ahora mismo. Puede haber crecido por un `slow_down`. */
  intervaloMs: number
  /** Cuánto se lleva esperado. Es lo que permite cortar sin depender del servidor. */
  esperaAcumuladaMs: number
  /** Cuánto dura el código, según lo dijo el `start`. */
  venceEnMs: number
}

export type PasoDeLogin =
  | { accion: 'reintentar'; esperarMs: number; intervaloMs: number }
  | { accion: 'listo'; token: string; deviceId: string }
  | { accion: 'cortar'; motivo: 'vencido' | 'rechazado'; detalle?: string }

/**
 * Cuánto se agranda el intervalo cuando el servidor dice que se está preguntando muy seguido.
 * Es el valor del RFC 8628, que es de donde sale este flujo.
 */
export const INCREMENTO_POR_LENTO = 5000

export function siguientePaso(respuesta: RespuestaDePoll, estado: EstadoDeLogin): PasoDeLogin {
  if (respuesta.status === 'linked') {
    return { accion: 'listo', token: respuesta.token, deviceId: respuesta.deviceId }
  }
  if (respuesta.status === 'expired') return { accion: 'cortar', motivo: 'vencido' }
  if (respuesta.status === 'denied') {
    return { accion: 'cortar', motivo: 'rechazado', detalle: respuesta.error }
  }

  // El corte por vigencia va DESPUÉS de los estados terminales y ANTES de decidir la espera:
  // un servidor que deja de contestar no puede dejar al usuario mirando una terminal que ya
  // no sirve para nada. No esperar a que el servidor lo diga es el punto.
  if (estado.esperaAcumuladaMs >= estado.venceEnMs) return { accion: 'cortar', motivo: 'vencido' }

  const intervaloMs = respuesta.status === 'slow_down'
    ? estado.intervaloMs + INCREMENTO_POR_LENTO
    : estado.intervaloMs
  return { accion: 'reintentar', esperarMs: intervaloMs, intervaloMs }
}

/**
 * Traduce lo que contestó `/v1/link/poll` al estado que entiende `siguientePaso`.
 *
 * Está separado del `fetch` porque es el punto donde una lectura equivocada del código HTTP
 * se convierte en una credencial vacía guardada como si fuera buena. **Lo único que cuenta
 * como conectado es un 200 CON token**: todo lo demás que no se reconozca es `sin-respuesta`,
 * o sea reintentar, que es el default seguro — el código sigue vivo del otro lado.
 */
export function interpretarRespuestaDePoll(status: number, cuerpo: unknown): RespuestaDePoll {
  const b = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as Record<string, unknown>

  if (status === 200) {
    const token = b.token
    const deviceId = b.device_id
    if (typeof token === 'string' && token !== '' && typeof deviceId === 'string' && deviceId !== '') {
      return { status: 'linked', token, deviceId }
    }
    // Un 200 sin token no es un éxito a medias: es algo que no entendemos.
    return { status: 'sin-respuesta' }
  }

  // El 400 sirve para dos cosas distintas —la espera del RFC 8628 y los errores de pedido—
  // así que no alcanza con el código: hay que mirar qué dijo.
  if (status === 400 && b.status === 'authorization_pending') return { status: 'authorization_pending' }
  if (status === 429) return { status: 'slow_down' }
  if (status === 410) return { status: 'expired' }
  if (status === 403) {
    return { status: 'denied', error: typeof b.error === 'string' ? b.error : undefined }
  }
  return { status: 'sin-respuesta' }
}
