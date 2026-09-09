// El unico origen de datos de la pantalla Memories y de su fila en la sidebar: los dos
// muestran lo mismo porque leen de aca, asi que no pueden discrepar.
//
// Todos los metodos nuevos son opcionales en window.memory (src/types.ts) — mismo contrato
// defensivo que useMemory.ts: un preload viejo no los expone y el arbol tiene que seguir
// montando igual, solo que sin esos datos. Y cada uno se pide con su propio catch: que el
// doctor falle no puede dejar la fila sin el conteo.
import { useCallback, useEffect, useRef, useState } from 'react'
import { summarizeMemories, type MemoriesStatus } from '../lib/memories-status'

export interface SessionVerdictLite {
  paneId: string
  aiType: string
  account: string
  health: 'writing' | 'silent' | 'disabled'
  sessionId: string | null
  startedAt: number
}

export interface BlockedGroupLite {
  reason: string
  count: number
  oldestAt: number
  reversible: boolean
}

export interface VaultLite {
  enabled: boolean
  rootDir: string
  noteCount: number
  conflictCount: number
  lastGeneratedAt: number | null
}

export interface MemoriesState {
  status: MemoriesStatus
  itemCount: number
  pendingCount: number
  connected: boolean
  sessions: SessionVerdictLite[]
  silentSessions: SessionVerdictLite[]
  blocked: BlockedGroupLite[]
  blockedTotal: number
  vault: VaultLite
  refresh: () => Promise<void>
}

const EMPTY_VAULT: VaultLite = {
  enabled: false, rootDir: '', noteCount: 0, conflictCount: 0, lastGeneratedAt: null,
}

/**
 * Cada cuanto se relee. El daemon empuja con debounce de 3s (spec §2.1), asi que 5s no
 * pierde nada y no pone a la UI a interrogar la base sin parar. `0` desactiva el poll
 * (los tests lo usan asi).
 */
const DEFAULT_POLL_MS = 5_000

export function useMemories(pollMs: number = DEFAULT_POLL_MS): MemoriesState {
  const [itemCount, setItemCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [connected, setConnected] = useState(false)
  const [available, setAvailable] = useState(true)
  const [sessions, setSessions] = useState<SessionVerdictLite[]>([])
  const [blocked, setBlocked] = useState<BlockedGroupLite[]>([])
  const [blockedTotal, setBlockedTotal] = useState(0)
  const [vault, setVault] = useState<VaultLite>(EMPTY_VAULT)

  // Evita setState despues de desmontar: el overlay se cierra mientras las 4 promesas
  // todavia estan en vuelo.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const refresh = useCallback(async () => {
    const api = typeof window === 'undefined' ? undefined : window.memory
    if (!api) {
      if (alive.current) setAvailable(false)
      return
    }

    const [status, sess, doc, vh] = await Promise.all([
      api.status().catch(() => null),
      api.sessions?.().catch(() => null) ?? Promise.resolve(null),
      api.doctor?.().catch(() => null) ?? Promise.resolve(null),
      api.vaultHealth?.().catch(() => null) ?? Promise.resolve(null),
    ])
    if (!alive.current) return

    setAvailable(!!status)
    if (status) {
      setItemCount(status.itemCount)
      setPendingCount(status.pendingCount)
      setConnected(status.connected)
    }
    setSessions(sess?.ok ? sess.sessions : [])
    setBlocked(doc?.ok ? doc.groups : [])
    setBlockedTotal(doc?.ok ? doc.blockedTotal : 0)
    setVault(vh?.ok
      ? {
        enabled: vh.enabled,
        rootDir: vh.rootDir,
        noteCount: vh.noteCount,
        conflictCount: vh.conflictCount,
        lastGeneratedAt: vh.lastGeneratedAt,
      }
      : EMPTY_VAULT)
  }, [])

  useEffect(() => {
    void refresh()
    if (pollMs <= 0) return
    const id = setInterval(() => { void refresh() }, pollMs)
    return () => clearInterval(id)
  }, [refresh, pollMs])

  const silentSessions = sessions.filter((s) => s.health === 'silent')

  const status = summarizeMemories({
    available,
    connected,
    itemCount,
    pendingCount,
    blockedTotal,
    vaultConflicts: vault.conflictCount,
    silentSessions: silentSessions.length,
  })

  return {
    status, itemCount, pendingCount, connected,
    sessions, silentSessions, blocked, blockedTotal, vault, refresh,
  }
}
