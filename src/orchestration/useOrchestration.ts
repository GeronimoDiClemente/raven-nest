import { useEffect, useState } from 'react'
import type { OrchestrationWorker } from '../types'

/**
 * Los workers de orquestación de todos los coordinadores. Pide `snapshot()` al montar y otra
 * vez con cada `orchestration:changed` (que llega sin payload). Una respuesta vieja que llega
 * después de una más nueva se descarta.
 */
export function useOrchestration(): OrchestrationWorker[] {
  const [workers, setWorkers] = useState<OrchestrationWorker[]>([])
  useEffect(() => {
    const api = window.orchestration
    if (!api) return
    let vivo = true
    let ultimo = 0
    const pedir = (): void => {
      const n = ++ultimo
      api.snapshot().then(
        (ws) => { if (vivo && n === ultimo) setWorkers(ws) },
        () => { /* main sin orquestación: queda lo último que se vio */ },
      )
    }
    pedir()
    const baja = api.onChanged(pedir)
    return () => {
      vivo = false
      baja()
    }
  }, [])
  return workers
}
