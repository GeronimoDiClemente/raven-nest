// Spec §2.2 / §7.1 ("fail loudly, no silent drops"). El cruce entre lo que Nest CREE que
// tiene memoria (los panes a los que pty-manager.ts:231 les inyecto NEST_MEMORY_SOCKET) y
// lo que el bridge VIO de verdad (la tabla `sessions`, que solo se escribe cuando
// hook.sessionStart llega a memory-ipc-server.ts:407). La diferencia entre esos dos
// conjuntos es el fallo mudo.
//
// Puro a proposito: sin PTY, sin socket, sin SQLite. main.ts junta los dos lados y llama.

/** Un pane que Nest lanzo con el bloque de memoria de pty-manager.ts activo. */
export interface PaneWithMemory {
  paneId: string
  aiType: string
  account: string
  /** `NEST_MEMORY_ENABLED === '1'` en el momento del spawn. */
  enabled: boolean
  startedAt: number
}

/** Una fila de `sessions` todavia abierta (ended_at IS NULL). */
export interface OpenSessionRow {
  id: string
  pane_id: string | null
  project_key: string
  ai_type: string | null
  account: string | null
  started_at: number
}

export type SessionHealth = 'writing' | 'silent' | 'disabled'

export interface SessionVerdict {
  paneId: string
  aiType: string
  account: string
  health: SessionHealth
  sessionId: string | null
  startedAt: number
}

/**
 * Cuanto se le da a una CLI recien lanzada para llegar al bridge antes de llamarla muda.
 * Claude Code corre SessionStart despues de resolver su config y sus MCP servers; 15s es
 * holgado para eso y sigue siendo corto para que el usuario lo note en la fila.
 */
export const SESSION_GRACE_MS = 15_000

export function reconcileSessions(
  panes: PaneWithMemory[],
  sessions: OpenSessionRow[],
  now: number,
  graceMs: number = SESSION_GRACE_MS
): SessionVerdict[] {
  // Una sesion sin pane_id no se le puede atribuir a ningun pane — un shim viejo, o una CLI
  // corriendo fuera de Nest. Se descarta del cruce en vez de asignarsela al primero.
  const byPane = new Map<string, OpenSessionRow>()
  for (const s of sessions) {
    if (s.pane_id) byPane.set(s.pane_id, s)
  }

  return panes.map((p) => {
    const session = byPane.get(p.paneId) ?? null
    let health: SessionHealth
    if (!p.enabled) {
      // Apagada a proposito: no es un fallo, y no tiene que gritar como uno.
      health = 'disabled'
    } else if (session) {
      health = 'writing'
    } else if (now - p.startedAt < graceMs) {
      // Todavia arrancando. Optimista a proposito: un falso "mudo" cada vez que se abre una
      // terminal entrenaria al usuario a ignorar el indicador.
      health = 'writing'
    } else {
      health = 'silent'
    }
    return {
      paneId: p.paneId,
      aiType: p.aiType,
      account: p.account,
      health,
      sessionId: session?.id ?? null,
      startedAt: p.startedAt,
    }
  })
}
