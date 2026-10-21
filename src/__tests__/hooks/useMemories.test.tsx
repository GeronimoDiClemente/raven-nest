// El hook tiene que sobrevivir a un preload viejo que no expone los metodos nuevos — mismo
// contrato que useMemory.ts ya respeta con setUser?/checkPendingAdoption? (ver el comentario
// de memoryApi() en src/hooks/useMemory.ts: montar sin la API tiraba el arbol entero abajo).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMemories } from '../../hooks/useMemories'

const setMemoryApi = (api: unknown): void => {
  ;(window as unknown as { memory?: unknown }).memory = api
}

afterEach(() => { setMemoryApi(undefined) })

describe('useMemories', () => {
  it('sin window.memory devuelve unavailable y no rompe', async () => {
    setMemoryApi(undefined)
    const { result } = renderHook(() => useMemories(0))
    await waitFor(() => expect(result.current.status.dot).toBe('grey'))
    expect(result.current.status.text).toBe('unavailable')
  })

  it('junta status + sessions + doctor + vault en un solo semaforo', async () => {
    setMemoryApi({
      status: vi.fn().mockResolvedValue({
        connected: true, deviceId: 'd1', itemCount: 142, pendingCount: 0, daemonStatus: 'idle',
      }),
      sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [], silentCount: 0 }),
      doctor: vi.fn().mockResolvedValue({ ok: true, blockedTotal: 0, groups: [] }),
      vaultHealth: vi.fn().mockResolvedValue({
        ok: true, enabled: true, rootDir: '/vault', noteCount: 866, conflictCount: 0, lastGeneratedAt: 1,
      }),
    })

    const { result } = renderHook(() => useMemories(0))

    await waitFor(() => expect(result.current.status.dot).toBe('green'))
    expect(result.current.status.text).toBe('142 items · synced')
    expect(result.current.vault.noteCount).toBe(866)
  })

  it('una sesion muda pone la fila en rojo y queda listada', async () => {
    setMemoryApi({
      status: vi.fn().mockResolvedValue({
        connected: true, deviceId: 'd1', itemCount: 10, pendingCount: 0, daemonStatus: 'idle',
      }),
      sessions: vi.fn().mockResolvedValue({
        ok: true,
        sessions: [{
          paneId: 'p1', aiType: 'claude', account: 'claude:Gero Personal',
          health: 'silent', sessionId: null, startedAt: 1,
        }],
        silentCount: 1,
      }),
      doctor: vi.fn().mockResolvedValue({ ok: true, blockedTotal: 0, groups: [] }),
      vaultHealth: vi.fn().mockResolvedValue({
        ok: true, enabled: false, rootDir: '', noteCount: 0, conflictCount: 0, lastGeneratedAt: null,
      }),
    })

    const { result } = renderHook(() => useMemories(0))

    await waitFor(() => expect(result.current.status.dot).toBe('red'))
    expect(result.current.silentSessions).toHaveLength(1)
    expect(result.current.silentSessions[0].paneId).toBe('p1')
  })

  it('un preload viejo sin los metodos nuevos sigue mostrando el conteo', async () => {
    setMemoryApi({
      status: vi.fn().mockResolvedValue({
        connected: true, deviceId: 'd1', itemCount: 5, pendingCount: 0, daemonStatus: 'idle',
      }),
    })

    const { result } = renderHook(() => useMemories(0))

    await waitFor(() => expect(result.current.itemCount).toBe(5))
    expect(result.current.status.dot).toBe('green')
    expect(result.current.blockedTotal).toBe(0)
  })

  it('si un IPC nuevo explota, el resto de la fila sigue mostrandose', async () => {
    setMemoryApi({
      status: vi.fn().mockResolvedValue({
        connected: true, deviceId: 'd1', itemCount: 7, pendingCount: 0, daemonStatus: 'idle',
      }),
      sessions: vi.fn().mockRejectedValue(new Error('boom')),
      doctor: vi.fn().mockRejectedValue(new Error('boom')),
      vaultHealth: vi.fn().mockRejectedValue(new Error('boom')),
    })

    const { result } = renderHook(() => useMemories(0))

    await waitFor(() => expect(result.current.itemCount).toBe(7))
    expect(result.current.status.dot).toBe('green')
    expect(result.current.silentSessions).toEqual([])
  })

  it('2b-1: el tope del plan no prende el ámbar y trae max_projects', async () => {
    setMemoryApi({
      status: vi.fn().mockResolvedValue({
        connected: true, deviceId: 'd1', itemCount: 9, pendingCount: 0, daemonStatus: 'idle', limits: { max_projects: 1 },
      }),
      doctor: vi.fn().mockResolvedValue({
        ok: true, blockedTotal: 7, groups: [{ reason: 'project_limit_reached', count: 7, oldestAt: 1, reversible: true }],
      }),
    })

    const { result } = renderHook(() => useMemories(0))

    await waitFor(() => expect(result.current.maxProjects).toBe(1))
    expect(result.current.status).toEqual({ dot: 'green', text: '9 items · synced' })
    expect(result.current.blocked).toHaveLength(1)
  })

  it('2b-1: con otro motivo al lado, «N blocked» cuenta sólo ese', async () => {
    setMemoryApi({
      status: vi.fn().mockResolvedValue({ connected: true, deviceId: 'd1', itemCount: 9, pendingCount: 0, daemonStatus: 'idle' }),
      doctor: vi.fn().mockResolvedValue({
        ok: true, blockedTotal: 10,
        groups: [
          { reason: 'project_limit_reached', count: 7, oldestAt: 1, reversible: true },
          { reason: 'quota_exceeded', count: 3, oldestAt: 1, reversible: true },
        ],
      }),
    })

    const { result } = renderHook(() => useMemories(0))

    await waitFor(() => expect(result.current.status).toEqual({ dot: 'amber', text: '3 blocked' }))
    expect(result.current.maxProjects).toBeNull()
  })
})
