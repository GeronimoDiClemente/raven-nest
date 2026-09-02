/**
 * Ventana fija por clave, en memoria.
 *
 * EN MEMORIA Y POR PROCESO a propósito: se reinicia en cada deploy y no se comparte entre
 * réplicas. Con una sola instancia — que es el beta — alcanza, y es honesto decir dónde
 * está el techo: el día que haya dos réplicas, cada una deja pasar el límite entero y esto
 * tiene que mudarse a Redis o a una tabla.
 *
 * El reloj se inyecta para que los tests no dependan de esperar de verdad.
 */
export interface RateLimiter {
  check(key: string): { ok: true } | { ok: false; retryAfterSeconds: number }
}

export function createRateLimiter(opts: {
  limit: number
  windowMs: number
  now?: () => number
}): RateLimiter {
  const now = opts.now ?? (() => Date.now())
  const windows = new Map<string, { start: number; count: number }>()

  return {
    check(key) {
      const t = now()
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
  }
}
