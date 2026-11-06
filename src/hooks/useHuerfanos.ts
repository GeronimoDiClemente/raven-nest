import { useCallback, useEffect, useRef, useState } from 'react'
import type { OrphanProcess } from '../types'
import { useIntervaloVisible } from './useIntervaloVisible'

// El main barre cada 5 minutos y guarda el resultado: preguntarle cada minuto es leer una
// lista en memoria, no correr `ps`. Al abrir el popover sí se pide un barrido nuevo.
const INTERVALO_MS = 60_000

export interface UseHuerfanos {
  huerfanos: OrphanProcess[]
  matar: (pid: number) => Promise<{ ok: true } | { ok: false; error: string }>
}

export function useHuerfanos(abierto: boolean): UseHuerfanos {
  const [huerfanos, setHuerfanos] = useState<OrphanProcess[]>([])
  const montado = useRef(true)
  useEffect(() => () => { montado.current = false }, [])

  const leer = useCallback(async (refrescar: boolean) => {
    try {
      const h = await window.metrics.orphans(refrescar)
      if (montado.current) setHuerfanos(h)
    } catch { /* sin main que conteste, queda lo último que se vio */ }
  }, [])

  useIntervaloVisible(() => { void leer(false) }, INTERVALO_MS)
  useEffect(() => { if (abierto) void leer(true) }, [abierto, leer])

  const matar = useCallback(async (pid: number) => {
    const r = await window.metrics.killOrphan(pid)
    await leer(true)
    return r
  }, [leer])

  return { huerfanos, matar }
}
