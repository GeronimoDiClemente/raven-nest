// Spec 2b-2 §4.8: useMemory expone el proyecto elegido y elige por el daemon.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useMemory } from '../../hooks/useMemory'

const supabaseMock = vi.hoisted(() => ({
  functions: { invoke: vi.fn() },
  auth: {
    getSession: vi.fn(), getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  },
}))
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

const memoryMock = {
  status: vi.fn(),
  doctor: vi.fn().mockResolvedValue({ ok: true, blockedTotal: 0, groups: [], localOnlyProjects: [] }),
  keepProject: vi.fn().mockResolvedValue({ ok: true }),
  onStatus: vi.fn(),
  removeStatusListener: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { memory: unknown }).memory = memoryMock
  memoryMock.status.mockResolvedValue({
    connected: true, deviceId: 'd', itemCount: 0, pendingCount: 0, daemonStatus: 'idle',
    limits: { max_projects: 1 }, cloudProjects: [{ projectKey: 'k-a', name: 'a' }, { projectKey: 'k-b', name: 'b' }],
    keptProjectKey: 'k-b', overLimit: true,
  })
})

describe('useMemory — proyecto elegido', () => {
  it('expone keptProjectKey y overLimit del status', async () => {
    const { result } = renderHook(() => useMemory())
    await waitFor(() => expect(result.current.overLimit).toBe(true))
    expect(result.current.keptProjectKey).toBe('k-b')
  })

  it('un status sin los campos los deja en null y false', async () => {
    memoryMock.status.mockResolvedValue({ connected: true, deviceId: 'd', itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    const { result } = renderHook(() => useMemory())
    await waitFor(() => expect(result.current.state).toBe('connected'))
    expect(result.current.keptProjectKey).toBeNull()
    expect(result.current.overLimit).toBe(false)
  })

  it('keepProject llama al daemon y refresca', async () => {
    const { result } = renderHook(() => useMemory())
    await waitFor(() => expect(result.current.overLimit).toBe(true))
    const llamadasAntes = memoryMock.status.mock.calls.length
    await act(async () => { expect(await result.current.keepProject('k-a')).toEqual({ ok: true }) })
    expect(memoryMock.keepProject).toHaveBeenCalledWith('k-a')
    expect(memoryMock.status.mock.calls.length).toBeGreaterThan(llamadasAntes)
  })

  it('si el IPC rechaza, devuelve el error en vez de tirar y refresca igual', async () => {
    const { result } = renderHook(() => useMemory())
    await waitFor(() => expect(result.current.overLimit).toBe(true))
    memoryMock.keepProject.mockRejectedValueOnce(new Error('ipc down'))
    const llamadasAntes = memoryMock.status.mock.calls.length
    let r: { ok: boolean; error?: string } | undefined
    await act(async () => { r = await result.current.keepProject('k-a') })
    expect(r).toEqual({ ok: false, error: 'ipc down' })
    expect(memoryMock.status.mock.calls.length).toBeGreaterThan(llamadasAntes)
  })
})
