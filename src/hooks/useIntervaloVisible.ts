import { useEffect, useRef } from 'react'
import { startIntervaloVisible } from '../lib/intervalo-visible'

/**
 * La misma programación que `useIntervaloVisible`, para usar adentro de un `useEffect`
 * propio: cuando el poll depende de props y tiene que reiniciarse (y tickear en el acto) al
 * cambiarlas, o descartar resultados viejos con un flag `cancelled`. Tickea en el acto si la
 * ventana se ve. Devuelve el `stop`.
 */
export function intervaloVisibleEnDocumento(tick: () => void, ms: number): () => void {
  const scheduler = startIntervaloVisible({
    tick,
    setTimer: (cb, d) => window.setTimeout(cb, d),
    clearTimer: (id) => window.clearTimeout(id),
    alCambiarVisibilidad: (cb) => {
      document.addEventListener('visibilitychange', cb)
      return () => document.removeEventListener('visibilitychange', cb)
    },
    seVe: () => document.visibilityState === 'visible',
    ms,
  })
  return () => scheduler.stop()
}

/**
 * Corre `tick` cada `ms`, pero **sólo mientras la ventana se vea**, y una vez en el acto
 * al volver a verse. El porqué —y cuándo NO usarlo— está en `lib/intervalo-visible.ts`.
 *
 * El callback se guarda en un ref a propósito: si el intervalo dependiera de su identidad,
 * un `tick` declarado en el cuerpo del componente lo recrearía en cada render y el timer
 * arrancaría de cero cada vez, que es la forma habitual de que un poll no dispare nunca.
 */
export function useIntervaloVisible(tick: () => void, ms: number, activo = true): void {
  const tickRef = useRef(tick)
  tickRef.current = tick

  useEffect(() => {
    if (!activo || ms <= 0) return
    return intervaloVisibleEnDocumento(() => tickRef.current(), ms)
  }, [ms, activo])
}
