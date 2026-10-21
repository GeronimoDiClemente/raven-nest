import { useCallback, useEffect, useRef, useState } from 'react'
import { cambioDePlan } from '../lib/cambio-de-plan'

const DURACION_DEL_AVISO_MS = 8000

/**
 * Spec 2b-2 §4.8: cuando `useProfile` ve el plan pasar a `cloud` (relectura por foco al volver
 * del navegador de pagar), aviso + status nuevo al daemon: con eso actúa lo de 2b-1 —el tope
 * sube y lo retenido converge solo—. Al bajar de un pago, sólo el status.
 *
 * Lo leído mientras `cargando` no cuenta: `useProfile` arranca en `free` y la primera lectura
 * real no es un cambio (Review Focus 1).
 *
 * `plan` es el plan CRUDO de `profiles` (Ruling P3: el efectivo de un trial es `team`). Cuando
 * cambia `usuario` (login, logout, otra cuenta) la lectura es una línea de base nueva y no un
 * cambio (Ruling P4): entrar a una cuenta que ya es Cloud no la "activa".
 */
export function useAvisoDeCambioDePlan(
  plan: string,
  cargando: boolean,
  usuario: string | null = null,
): { avisoVisible: boolean; cerrarAviso: () => void } {
  const anterior = useRef<{ plan: string; usuario: string | null } | null>(null)
  const [avisoVisible, setAvisoVisible] = useState(false)

  useEffect(() => {
    if (cargando) return
    const previo = anterior.current
    anterior.current = { plan, usuario }
    const antes = previo !== null && previo.usuario === usuario ? previo.plan : null
    const cambio = cambioDePlan(antes, plan)
    if (cambio === null) return
    void window.memory?.refreshStatus?.()
    if (cambio === 'activado') setAvisoVisible(true)
  }, [plan, cargando, usuario])

  useEffect(() => {
    if (!avisoVisible) return
    const t = setTimeout(() => setAvisoVisible(false), DURACION_DEL_AVISO_MS)
    return () => clearTimeout(t)
  }, [avisoVisible])

  const cerrarAviso = useCallback(() => setAvisoVisible(false), [])
  return { avisoVisible, cerrarAviso }
}
