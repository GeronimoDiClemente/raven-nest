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
  if (!input.connected) return { dot: 'grey', text: `${plural(input.itemCount, 'item', 'items')} · local only` }

  return { dot: 'green', text: `${plural(input.itemCount, 'item', 'items')} · synced` }
}

/** Compartido por MemoriesStatusRow (vault "ago") y la nota abierta (metadatos y panel) —
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

/**
 * Spec 2b-1 §4.5: el motivo con el que el servidor retiene lo que pasa el tope de proyectos del
 * plan. Mismo literal que `MOTIVO_TOPE_DE_PROYECTOS` de electron/memory-daemon.ts (el renderer
 * no importa de electron/, D13).
 */
export const MOTIVO_TOPE_DE_PLAN = 'project_limit_reached'

/** Las bloqueadas que son una FALLA: todas menos las del tope del plan (D7). Es lo que va al
 *  punto ámbar y al «N blocked» de `summarizeMemories`. */
export function bloqueadasPorFalla(groups: ReadonlyArray<{ reason: string; count: number }>): number {
  return groups.reduce((total, g) => (g.reason === MOTIVO_TOPE_DE_PLAN ? total : total + g.count), 0)
}

/** El badge de la fila de estado para lo retenido por el tope (spec 2b-1 §4.7). */
export function textoDeTopeDePlan(n: number, max: number | null): string {
  const queda = `${n} ${n === 1 ? 'memory stays' : 'memories stay'} on this machine`
  // D6: sin tope informado no se inventa cuántos proyectos sincroniza el plan.
  if (max === null) return queda
  return `${queda} — your plan syncs ${max === 1 ? 'one project' : `${max} projects`}`
}
