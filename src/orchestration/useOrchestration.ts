import { useEffect, useState } from 'react'
import type { OrchestrationReviewEntry, OrchestrationWorker } from '../types'

/**
 * Pide `fetch()` al montar y otra vez con cada `orchestration:changed` (que llega sin payload).
 * Una respuesta vieja que llega después de una más nueva se descarta. Con `enabled` en false no
 * se suscribe (un pane que no es worker no paga el IPC).
 */
function useOrchestrationList<T>(
  fetch: (api: Window['orchestration']) => Promise<T[]>,
  enabled: boolean,
): T[] {
  const [items, setItems] = useState<T[]>([])
  useEffect(() => {
    const api = window.orchestration
    if (!api || !enabled) return
    let vivo = true
    let ultimo = 0
    const pedir = (): void => {
      const n = ++ultimo
      let p: Promise<T[]>
      try {
        p = fetch(api)
      } catch {
        return // preload viejo sin el método
      }
      p.then(
        (xs) => { if (vivo && n === ultimo) setItems(Array.isArray(xs) ? xs : []) },
        () => { /* main sin orquestación: queda lo último que se vio */ },
      )
    }
    pedir()
    const baja = api.onChanged(pedir)
    return () => {
      vivo = false
      baja()
    }
    // `fetch` es una de las dos funciones de módulo de abajo: estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
  return items
}

const pedirSnapshot = (api: Window['orchestration']) => api.snapshot()
const pedirRevision = (api: Window['orchestration']) => api.reviewList()

/** Los workers de orquestación de todos los coordinadores. */
export function useOrchestration(enabled = true): OrchestrationWorker[] {
  return useOrchestrationList(pedirSnapshot, enabled)
}

/** Las ramas terminadas que esperan la decisión de Gero (persisten entre reinicios). */
export function useReviewEntries(enabled = true): OrchestrationReviewEntry[] {
  return useOrchestrationList(pedirRevision, enabled)
}
