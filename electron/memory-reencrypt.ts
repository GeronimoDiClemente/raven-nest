// Spec §5.5.3: lo que ya esta en la nube en claro hay que subirlo de nuevo cifrado.
//
// No hay endpoint de migracion ni script de servidor y no hacen falta: el push ya cifra
// y el upsert del servidor es por `sync_id`, asi que re-encolar todo y dejar que el daemon
// haga su trabajo ES la migracion.
import type { MemoryStore } from './memory-store'

export interface ReencryptProgress {
  /** Observaciones vivas que hay que re-subir. */
  total: number
  /** Cuantas siguen esperando en la cola de push. */
  queued: number
}

/**
 * `pullFallo`: no se pudo bajar todo antes del snapshot, así que no se re-encoló nada. El que
 * llama lo deja para el próximo disparo (ver `reuploadAutomaticoUnaVez` en main.ts).
 */
export type ResultadoDeReencrypt = ReencryptProgress & { pullFallo?: true }

export function planReencrypt(store: MemoryStore): ReencryptProgress {
  return { total: store.count(), queued: store.pendingMutationCount() }
}

/**
 * Baja todo, encola todo y empuja hasta que la cola se vacia.
 *
 * N1 (re-review del cifrado obligatorio): el pull completo va ANTES del snapshot y no es
 * opcional. Una máquina que no tenía la clave conserva versiones viejas de filas que otra
 * editó o borró (las bajó ilegibles y no las aplicó); re-subirlas tal cual pisaba la edición
 * nueva en la nube o resucitaba el borrado. Con la clave ya puesta, el pull las descifra y las
 * aplica por LWW, y recién ahí se toma el snapshot. Si el pull no llega al final, NO se re-sube
 * nada: un snapshot sin refrescar es justo lo que hay que evitar. El servidor además ignora
 * una mutación más vieja que su fila (`stale`, server/src/push.ts), pero eso es la red de
 * abajo, no el plan.
 *
 * El corte por falta de progreso no es una optimizacion, es lo unico que separa esto de un
 * bucle infinito: sin red, con la cuota llena o con todo bloqueado, `push()` vuelve sin
 * haber movido nada y girar de nuevo daria exactamente el mismo resultado. Se corta y se
 * devuelve lo que queda; el daemon lo va a seguir intentando por su cuenta en cada ciclo
 * normal, que es donde ese reintento corresponde.
 */
export async function runReencrypt(
  store: MemoryStore,
  daemon: { push(): Promise<void>; pullCompleto(): Promise<boolean> },
  onProgress?: (p: ReencryptProgress) => void,
  opts: { conSuperseded?: boolean } = {}
): Promise<ResultadoDeReencrypt> {
  if (!(await daemon.pullCompleto())) {
    return { total: 0, queued: store.pendingMutationCount(), pullFallo: true }
  }
  const total = store.requeueAllForPush(opts)
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
