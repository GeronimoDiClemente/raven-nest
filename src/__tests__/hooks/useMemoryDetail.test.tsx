import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMemoryDetail } from '../../hooks/useMemoryDetail'

const det = (syncId: string, title: string) => ({
  syncId, projectKey: 'p1', scope: 'project', type: 'decision', title, content: '', tags: [],
  topicKey: null, gitBranch: null, originAi: null, authorDisplay: null, createdAt: 1, updatedAt: 1,
  supersededBy: null, revisionCount: 1,
})

afterEach(() => { delete (window as unknown as { memory?: unknown }).memory })

describe('useMemoryDetail', () => {
  it('el nonce vuelve a leer la misma memoria sin vaciar el detalle mientras carga', async () => {
    let resolver: ((v: unknown) => void) | null = null
    const observation = vi.fn()
      .mockResolvedValueOnce(det('a', 'v1'))
      .mockImplementationOnce(() => new Promise((r) => { resolver = r }))
    ;(window as unknown as { memory: unknown }).memory = { observation }

    const { result, rerender } = renderHook(({ id, n }) => useMemoryDetail(id, n), { initialProps: { id: 'a', n: 0 } })
    await waitFor(() => expect(result.current.detail?.title).toBe('v1'))

    rerender({ id: 'a', n: 1 })
    await waitFor(() => expect(observation).toHaveBeenCalledTimes(2))
    // Recargando: el anterior sigue, con loading.
    expect(result.current.detail?.title).toBe('v1')
    expect(result.current.loading).toBe(true)

    resolver!(det('a', 'v2'))
    await waitFor(() => expect(result.current.detail?.title).toBe('v2'))
    expect(result.current.loading).toBe(false)
  })

  it('otra memoria sí vacía el detalle mientras carga', async () => {
    const observation = vi.fn()
      .mockResolvedValueOnce(det('a', 'A'))
      .mockImplementationOnce(() => new Promise(() => {}))
    ;(window as unknown as { memory: unknown }).memory = { observation }
    const { result, rerender } = renderHook(({ id }) => useMemoryDetail(id), { initialProps: { id: 'a' } })
    await waitFor(() => expect(result.current.detail?.title).toBe('A'))
    rerender({ id: 'b' })
    expect(result.current.detail).toBeNull()
    expect(result.current.loading).toBe(true)
  })
})
