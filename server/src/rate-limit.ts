/**
 * Ventana fija por clave, en memoria.
 *
 * EN MEMORIA Y POR PROCESO a propósito: se reinicia en cada deploy y no se comparte entre
 * réplicas. Con una sola instancia — que es el beta — alcanza, y es honesto decir dónde
 * está el techo: el día que haya dos réplicas, cada una deja pasar el límite entero y esto
 * tiene que mudarse a Redis o a una tabla.
 *
 * Dentro de UNA misma corrida el `Map` queda acotado por una purga perezosa: no hay
 * `setInterval` (eso rompería que este módulo sea puro/determinista y obligaría a `unref`
 * y a limpiarlo en los tests) — en cambio, cada `check()` se fija si ya pasó al menos una
 * ventana entera desde el último barrido y, si es así, tira del `Map` las entradas cuya
 * propia ventana ya venció. El costo queda amortizado sobre el tráfico normal en vez de
 * correr en cada llamada. Sin esto, cada deviceId que alguna vez llamó `check()` — incluso
 * uno revocado hace meses — se quedaba en el `Map` para siempre: en un proceso de una sola
 * instancia que puede correr meses sin redeploy, eso es memoria retenida sin límite. Con la
 * purga, el `Map` queda acotado a los devices activos en la ventana actual, no a todos los
 * que existieron alguna vez.
 *
 * El reloj se inyecta para que los tests no dependan de esperar de verdad.
 */
export interface RateLimiter {
  check(key: string): { ok: true } | { ok: false; retryAfterSeconds: number }
  /** Sólo para tests: cuántas entradas quedan vivas en el Map, para poder probar que la
   * purga perezosa realmente libera memoria y no sólo lo dice en un comentario. */
  size(): number
}

export function createRateLimiter(opts: {
  limit: number
  windowMs: number
  now?: () => number
}): RateLimiter {
  const now = opts.now ?? (() => Date.now())
  const windows = new Map<string, { start: number; count: number }>()
  let lastSweep = now()

  function sweep(t: number): void {
    if (t - lastSweep < opts.windowMs) return
    lastSweep = t
    for (const [key, w] of windows) {
      if (t - w.start >= opts.windowMs) windows.delete(key)
    }
  }

  return {
    check(key) {
      const t = now()
      sweep(t)
      const w = windows.get(key)
      if (!w || t - w.start >= opts.windowMs) {
        windows.set(key, { start: t, count: 1 })
        return { ok: true }
      }
      if (w.count < opts.limit) {
        w.count++
        return { ok: true }
      }
      return { ok: false, retryAfterSeconds: Math.ceil((w.start + opts.windowMs - t) / 1000) }
    },
    size() {
      return windows.size
    },
  }
}
