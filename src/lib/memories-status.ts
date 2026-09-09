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
