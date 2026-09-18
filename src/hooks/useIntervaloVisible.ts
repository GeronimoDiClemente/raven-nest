import { useEffect, useRef } from 'react'
import { startIntervaloVisible } from '../lib/intervalo-visible'

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
    const scheduler = startIntervaloVisible({
      tick: () => tickRef.current(),
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
  }, [ms, activo])
}
