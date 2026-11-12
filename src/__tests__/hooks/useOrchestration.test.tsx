import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useOrchestration } from '../../orchestration/useOrchestration'
import type { OrchestrationWorker } from '../../types'

const w = (id: string): OrchestrationWorker => ({
  workerId: id, coordinatorPaneId: 'c', paneId: `p-${id}`, label: id, colorIndex: 0, branch: `nest/${id}`,
  worktreePath: `/wt/${id}`, baseBranch: 'main', agent: 'claude', status: 'working', createdAt: 1,
})

afterEach(() => {
  delete (window as { orchestration?: unknown }).orchestration
})

describe('useOrchestration', () => {
  it('pide el snapshot al montar y de nuevo con cada changed; la baja suelta el oyente', async () => {
    let changed: (() => void) | null = null
    const baja = vi.fn()
    const snapshot = vi.fn().mockResolvedValueOnce([w('a')]).mockResolvedValueOnce([w('a'), w('b')])
    ;(window as unknown as { orchestration: unknown }).orchestration = {
      snapshot,
      onChanged: (cb: () => void) => { changed = cb; return baja },
    }
    const { result, unmount } = renderHook(() => useOrchestration())
    await waitFor(() => expect(result.current.map((x) => x.workerId)).toEqual(['a']))
    act(() => changed!())
    await waitFor(() => expect(result.current.map((x) => x.workerId)).toEqual(['a', 'b']))
    unmount()
    expect(baja).toHaveBeenCalledTimes(1)
  })

  it('una respuesta vieja que llega tarde no pisa a la nueva', async () => {
    let changed: (() => void) | null = null
    let soltarVieja: (v: OrchestrationWorker[]) => void = () => {}
    const snapshot = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { soltarVieja = r }))
      .mockResolvedValueOnce([w('nuevo')])
    ;(window as unknown as { orchestration: unknown }).orchestration = {
      snapshot,
      onChanged: (cb: () => void) => { changed = cb; return () => {} },
    }
    const { result } = renderHook(() => useOrchestration())
    act(() => changed!())
    await waitFor(() => expect(result.current.map((x) => x.workerId)).toEqual(['nuevo']))
    await act(async () => { soltarVieja([w('viejo')]) })
    expect(result.current.map((x) => x.workerId)).toEqual(['nuevo'])
  })

  it('sin la API (tests, preload viejo) devuelve lista vacía', () => {
    const { result } = renderHook(() => useOrchestration())
    expect(result.current).toEqual([])
  })
})
