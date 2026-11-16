// El handler de `memory:updateFromUi`, fuera de main.ts para poder probarlo sin Electron.
// Lo que importa es el `saved` que devuelve — lo que QUEDÓ guardado,
// que no es lo que se mandó: acá se hace trim y `update()` pasa `redact()`. El editor lo usa
// para reconocer el eco de su propio guardado (onChanged) y no tomarlo por un cambio de otro.
import type { ObservationRow, UpdateMemoryInput, UpdateMemoryResult } from './memory-store'

export interface StoreParaActualizar {
  update(input: UpdateMemoryInput): UpdateMemoryResult
  get(syncId: string): Pick<ObservationRow, 'title' | 'content' | 'deleted'> | null
}

export interface PedidoDeActualizacion {
  syncId?: string
  title?: string
  content?: string
  tags?: string[]
}

export type RespuestaDeActualizacion =
  | { ok: boolean; reason: UpdateMemoryResult['reason'] | null; saved?: { title: string; content: string } }
  | { ok: false; error: string }

/**
 * Corrige una memoria escrita a mano con el mismo `store.update()` que usa la tool
 * `memory_update` del MCP. `alCambiar` corre sólo si algo cambió de verdad (en main: programar
 * el push; empujar por una corrección que no corrige nada gastaría un ciclo de sync por nada).
 */
export function actualizarDesdeUi(
  store: StoreParaActualizar,
  input: PedidoDeActualizacion | null | undefined,
  alCambiar: () => void,
): RespuestaDeActualizacion {
  const syncId = (input?.syncId ?? '').trim()
  if (!syncId) return { ok: false, error: 'missing_sync_id' }
  try {
    const res = store.update({
      syncId,
      title: input?.title?.trim(),
      content: input?.content?.trim(),
      tags: input?.tags,
    })
    if (res.updated) alCambiar()
    let saved: { title: string; content: string } | undefined
    if (res.updated || res.reason === 'unchanged') {
      const row = store.get(res.syncId ?? syncId)
      if (row && row.deleted !== 1) saved = { title: row.title, content: row.content ?? '' }
    }
    return { ok: res.updated, reason: res.reason ?? null, ...(saved ? { saved } : {}) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'update_failed' }
  }
}
