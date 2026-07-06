import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useInstalledPlugins } from '../../hooks/useInstalledPlugins'

describe('useInstalledPlugins', () => {
  beforeEach(() => {
    const data: unknown[] = []
    ;(globalThis as unknown as { window: Window }).window.plugins = {
      list: vi.fn(() => Promise.resolve([...data] as never)),
      save: vi.fn((p: never) => { data.push(p); return Promise.resolve() }),
      delete: vi.fn((id: string) => {
        const i = data.findIndex((x) => (x as { pluginId: string }).pluginId === id)
        if (i >= 0) data.splice(i, 1)
        return Promise.resolve()
      }),
    } as never
  })

  it('install agrega el plugin y isInstalled lo refleja', async () => {
    const { result } = renderHook(() => useInstalledPlugins())
    await waitFor(() => expect(result.current.installed).toEqual([]))
    await act(async () => { await result.current.install('slack', { channel: '#dev' }) })
    expect(result.current.isInstalled('slack')).toBe(true)
    await act(async () => { await result.current.uninstall('slack') })
    expect(result.current.isInstalled('slack')).toBe(false)
  })

  it('sincroniza instancias: instalar desde una refresca la otra (evento window)', async () => {
    const a = renderHook(() => useInstalledPlugins())
    const b = renderHook(() => useInstalledPlugins())
    await waitFor(() => expect(a.result.current.installed).toEqual([]))
    await waitFor(() => expect(b.result.current.installed).toEqual([]))

    await act(async () => { await a.result.current.install('demo') })
    await waitFor(() => expect(b.result.current.isInstalled('demo')).toBe(true))

    await act(async () => { await b.result.current.uninstall('demo') })
    await waitFor(() => expect(a.result.current.isInstalled('demo')).toBe(false))
  })
})
