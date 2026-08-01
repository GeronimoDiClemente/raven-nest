import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useMemory } from '../../hooks/useMemory'

const supabaseMock = vi.hoisted(() => ({
  functions: { invoke: vi.fn() },
}))

vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

const memoryMock = {
  ensureDeviceId: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  status: vi.fn(),
  onStatus: vi.fn(),
  removeStatusListener: vi.fn(),
}

describe('useMemory disconnect', () => {
  const calls: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    calls.length = 0
    ;(globalThis as unknown as { window: Window }).window.memory = memoryMock as never

    memoryMock.status.mockResolvedValue({
      connected: true,
      deviceId: 'device-1',
      itemCount: 0,
      pendingCount: 0,
      daemonStatus: 'idle',
    })
    memoryMock.disconnect.mockImplementation(async () => {
      calls.push('disconnect')
      return { ok: true }
    })
    supabaseMock.functions.invoke.mockImplementation(async () => {
      calls.push('revoke')
      return { data: {}, error: null }
    })
  })

  it('calls window.memory.disconnect BEFORE revoking the nmk_ token, so delete-cloud-data still authenticates', async () => {
    const { result } = renderHook(() => useMemory())

    await act(async () => {
      await result.current.disconnect(true)
    })

    expect(calls).toEqual(['disconnect', 'revoke'])
    expect(memoryMock.disconnect).toHaveBeenCalledWith({ deleteCloud: true })
    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith('memory-token', {
      body: { action: 'revoke', all: true },
    })
  })

  it('does not revoke tokens when deleteCloud is false', async () => {
    const { result } = renderHook(() => useMemory())

    await act(async () => {
      await result.current.disconnect(false)
    })

    expect(calls).toEqual(['disconnect'])
    expect(supabaseMock.functions.invoke).not.toHaveBeenCalled()
  })

  it('surfaces an error and does not crash if window.memory.disconnect rejects', async () => {
    memoryMock.disconnect.mockRejectedValueOnce(new Error('ipc down'))
    const { result } = renderHook(() => useMemory())

    await act(async () => {
      await result.current.disconnect(true)
    })

    await waitFor(() => expect(result.current.error).toBe('ipc down'))
    expect(supabaseMock.functions.invoke).not.toHaveBeenCalled()
  })

  // Finding 2 fix: supabase-js's functions.invoke() resolves { data, error } instead of
  // throwing on a failed revoke — the old code discarded this result, so a 5xx/offline
  // revoke still reported a clean disconnect and left the nmk_ token valid server-side.
  it('surfaces an error when the token revoke call resolves with an error instead of throwing', async () => {
    supabaseMock.functions.invoke.mockImplementation(async () => {
      calls.push('revoke')
      return { data: null, error: new Error('revoke failed: 503') }
    })
    const { result } = renderHook(() => useMemory())

    await act(async () => {
      await result.current.disconnect(true)
    })

    await waitFor(() => expect(result.current.error).toBe('revoke failed: 503'))
    expect(calls).toEqual(['disconnect', 'revoke'])
  })

  // Finding 2 fix: main.ts's memory:disconnect handler now reports a failed
  // delete-cloud-data call via `cloudDeleteFailed` instead of swallowing it — the hook
  // must surface that into its error state so the UI can tell the user cloud data may
  // still exist, while still treating the (local) disconnect itself as successful.
  it('surfaces cloudDeleteFailed from window.memory.disconnect as an error, without failing the disconnect', async () => {
    memoryMock.disconnect.mockImplementation(async () => {
      calls.push('disconnect')
      return { ok: true, cloudDeleteFailed: 'HTTP 500' }
    })
    const { result } = renderHook(() => useMemory())

    await act(async () => {
      await result.current.disconnect(true)
    })

    await waitFor(() => expect(result.current.error).toBe('Cloud data may not have been deleted: HTTP 500'))
    expect(calls).toEqual(['disconnect', 'revoke'])
  })
})
