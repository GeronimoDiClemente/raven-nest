// Spec §5.1 — el punto de color de la fila Memories, y su texto corto.
//
// El orden de prioridad NO es arbitrario: un estado tapa al siguiente solo si le importa
// mas al usuario. `silent` va primero porque es el unico donde esta perdiendo trabajo sin
// enterarse (§2.2); `blocked` antes que `conflicts` porque es lo que no esta llegando a la
// nube; `disconnected` al final porque en un plan Free es lo normal, no una falla.

export type MemoriesDot = 'green' | 'amber' | 'red' | 'grey'

export interface MemoriesStatusInput {
  /** Hay subsistema de memoria (window.memory respondio). */
  available: boolean
  /** Hay nube: el device esta registrado contra el servicio de sync. */
  connected: boolean
  itemCount: number
  pendingCount: number
  blockedTotal: number
  vaultConflicts: number
  silentSessions: number
}

export interface MemoriesStatus {
  dot: MemoriesDot
  text: string
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export function summarizeMemories(input: MemoriesStatusInput): MemoriesStatus {
  if (!input.available) return { dot: 'grey', text: 'unavailable' }

  if (input.silentSessions > 0) {
    return { dot: 'red', text: `${plural(input.silentSessions, 'session', 'sessions')} not writing` }
  }
  if (input.blockedTotal > 0) return { dot: 'amber', text: `${input.blockedTotal} blocked` }
  if (input.vaultConflicts > 0) {
    return { dot: 'amber', text: plural(input.vaultConflicts, 'conflict', 'conflicts') }
  }
  if (input.pendingCount > 0) return { dot: 'amber', text: `${input.pendingCount} pending` }
  if (!input.connected) return { dot: 'grey', text: `${input.itemCount} items · local only` }

  return { dot: 'green', text: `${input.itemCount} items · synced` }
}

/** Compartido por MemoriesStatusRow (vault "ago") y MemoriesList (fecha de cada fila) —
 *  una sola forma de decir "hace cuanto" en toda la pantalla. */
export function relativeTime(at: number | null): string {
  if (!at) return 'never'
  const mins = Math.round((Date.now() - at) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / (60 * 24))}d ago`
}

/**
 * Spec 2026-09-11 §2 — "los pane-ids se van". `App.tsx`'s `generateId()` produce
 * `pane-<n>-<timestamp-en-ms>` (p.ej. `pane-3-1789095333962`); el timestamp no le dice
 * a nadie cuál terminal cerrar, que es justo lo que el comentario original de
 * MemoriesStatusRow decía que quería lograr. Se muestra solo el número de pane — la
 * CLI que corre adentro (aiType) la agrega el caller al lado.
 *
 * Un paneId que no matchea el formato esperado (origen viejo, otro subsistema, o un
 * mock de test) se muestra tal cual: mejor un id crudo y reconocible que inventar un
 * número o mostrar `undefined`.
 */
export function paneDisplayLabel(paneId: string): string {
  const m = /^pane-(\d+)-\d+$/.exec(paneId)
  return m ? `pane ${m[1]}` : paneId
}
