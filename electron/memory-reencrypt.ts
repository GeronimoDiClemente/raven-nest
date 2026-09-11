// Spec §5.5.3: lo que ya esta en la nube en claro hay que subirlo de nuevo cifrado.
//
// No hay endpoint de migracion ni script de servidor y no hacen falta: el push ya cifra
// (Task 7) y el upsert del servidor es por `sync_id`, asi que re-encolar todo y dejar que
// el daemon haga su trabajo ES la migracion. Con una sola cuenta y ~866 observaciones son
// cinco lotes de 200.
import type { MemoryStore } from './memory-store'

export interface ReencryptProgress {
  /** Observaciones vivas que hay que re-subir. */
  total: number
  /** Cuantas siguen esperando en la cola de push. */
  queued: number
}

export function planReencrypt(store: MemoryStore): ReencryptProgress {
  return { total: store.count(), queued: store.pendingMutationCount() }
}

/**
 * Encola todo y empuja hasta que la cola se vacia.
 *
 * El corte por falta de progreso no es una optimizacion, es lo unico que separa esto de un
 * bucle infinito: sin red, con la cuota llena o con todo bloqueado, `push()` vuelve sin
 * haber movido nada y girar de nuevo daria exactamente el mismo resultado. Se corta y se
 * devuelve lo que queda; el daemon lo va a seguir intentando por su cuenta en cada ciclo
 * normal, que es donde ese reintento corresponde.
 */
export async function runReencrypt(
  store: MemoryStore,
  daemon: { push(): Promise<void> },
  onProgress?: (p: ReencryptProgress) => void
): Promise<ReencryptProgress> {
  const total = store.requeueAllForPush()
  let queued = store.pendingMutationCount()
  onProgress?.({ total, queued })

  while (queued > 0) {
    const antes = queued
    await daemon.push()
    queued = store.pendingMutationCount()
    onProgress?.({ total, queued })
    if (queued >= antes) break
  }

  return { total, queued }
}
