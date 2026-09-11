// Spec 2026-09-11 §1: el data-fetching de la lista cross-project — paginado por
// cursor, debounce de busqueda, y el contrato defensivo de "sin window.memory.crossProject
// no se cae, se marca unavailable" (mismo patron que useMemories.test.tsx).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useCrossProjectMemories } from '../../hooks/useCrossProjectMemories'
import type { CrossProjectObservation, CrossProjectMemoryPage } from '../../types'

const setMemoryApi = (api: unknown): void => {
  ;(window as unknown as { memory?: unknown }).memory = api
}

afterEach(() => { setMemoryApi(undefined) })

const item = (over: Partial<CrossProjectObservation> = {}): CrossProjectObservation => ({
  syncId: 's1',
  projectKey: 'p1',
  projectDisplayName: 'raven-nest',
  title: 'Decided to use FTS5',
  type: 'decision',
  scope: 'project',
  originAi: 'claude',
  authorDisplay: null,
  updatedAt: Date.now(),
  tags: [],
  ...over,
})

describe('useCrossProjectMemories', () => {
  it('sin window.memory.crossProject queda unavailable y no rompe', async () => {
    setMemoryApi({})
    const { result } = renderHook(() => useCrossProjectMemories(0))
    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.items).toEqual([])
  })

  it('carga la primera pagina al montar', async () => {
    const page: CrossProjectMemoryPage = { items: [item()], nextCursor: null }
    const crossProject = vi.fn().mockResolvedValue(page)
    setMemoryApi({ crossProject })

    const { result } = renderHook(() => useCrossProjectMemories(0))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.items).toHaveLength(1)
    expect(crossProject).toHaveBeenCalledWith(expect.objectContaining({ cursor: null }))
  })

  it('loadMore pide la pagina siguiente con el cursor devuelto y las concatena', async () => {
    const crossProject = vi.fn()
      .mockResolvedValueOnce({ items: [item({ syncId: 'a' })], nextCursor: 'cur-2' })
      .mockResolvedValueOnce({ items: [item({ syncId: 'b' })], nextCursor: null })
    setMemoryApi({ crossProject })

    const { result } = renderHook(() => useCrossProjectMemories(0))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.hasMore).toBe(true)

    act(() => { result.current.loadMore() })

    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(result.current.hasMore).toBe(false)
    expect(crossProject).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cur-2' }))
  })

  it('un fallo de IPC muestra error sin dejar una lista vacia mentirosa previa oculta', async () => {
    const crossProject = vi.fn().mockRejectedValue(new Error('boom'))
    setMemoryApi({ crossProject })

    const { result } = renderHook(() => useCrossProjectMemories(0))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toMatch(/boom/)
    expect(result.current.items).toEqual([])
  })

  it('cambiar la query reinicia la paginacion desde cero', async () => {
    const crossProject = vi.fn()
      .mockResolvedValueOnce({ items: [item({ syncId: 'a' })], nextCursor: 'cur-2' })
      .mockResolvedValueOnce({ items: [item({ syncId: 'z', title: 'algo distinto' })], nextCursor: null })
    setMemoryApi({ crossProject })

    const { result } = renderHook(() => useCrossProjectMemories(0))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    act(() => { result.current.setQuery('fts5') })

    await waitFor(() => expect(crossProject).toHaveBeenCalledTimes(2))
    expect(crossProject).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'fts5', cursor: null }))
    await waitFor(() => expect(result.current.items).toEqual([expect.objectContaining({ syncId: 'z' })]))
  })
})
