import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMemoryTabs, __reiniciarPestanas } from '../../hooks/useMemoryTabs'

beforeEach(() => { __reiniciarPestanas() })

describe('useMemoryTabs — pedido de Settings (Account → Memory settings)', () => {
  it('un pedido nuevo abre Settings al montar', () => {
    const { result } = renderHook(() => useMemoryTabs(false, 1))
    expect(result.current.activeId).toBe('settings')
  })

  it('el mismo pedido no se atiende dos veces: cerrar y reabrir no vuelve a Settings', () => {
    const a = renderHook(() => useMemoryTabs(false, 1))
    act(() => { a.result.current.close('settings') })
    a.unmount()
    const b = renderHook(() => useMemoryTabs(false, 1))
    expect(b.result.current.tabs.some((t) => t.kind === 'settings')).toBe(false)
    expect(b.result.current.activeId).toBe('graph')
  })

  it('con el workspace ya montado, un pedido nuevo activa Settings', () => {
    const { result, rerender } = renderHook(({ n }) => useMemoryTabs(false, n), { initialProps: { n: 0 } })
    expect(result.current.activeId).toBe('graph')
    rerender({ n: 1 })
    expect(result.current.activeId).toBe('settings')
  })

  it('openSettings(seccion) cambia la sección de la pestaña', () => {
    const { result } = renderHook(() => useMemoryTabs(false))
    act(() => { result.current.openSettings('encryption') })
    expect(result.current.tabs.find((t) => t.kind === 'settings')).toEqual({ kind: 'settings', section: 'encryption' })
  })
})

describe('useMemoryTabs — el pedido trae sección (Keep syncing → Sync)', () => {
  it('un pedido nuevo con seccionPedida cambia la sección de la pestaña Settings abierta', () => {
    const { result, rerender } = renderHook(
      ({ n, s }) => useMemoryTabs(false, n, 0, s),
      { initialProps: { n: 0, s: undefined as 'sync' | undefined } },
    )
    act(() => { result.current.openSettings('encryption') })
    rerender({ n: 1, s: 'sync' })
    expect(result.current.tabs.find((t) => t.kind === 'settings')).toEqual({ kind: 'settings', section: 'sync' })
  })

  it('un pedido sin sección conserva la que tenía', () => {
    const { result, rerender } = renderHook(({ n }) => useMemoryTabs(false, n), { initialProps: { n: 0 } })
    act(() => { result.current.openSettings('encryption') })
    rerender({ n: 1 })
    expect(result.current.tabs.find((t) => t.kind === 'settings')).toEqual({ kind: 'settings', section: 'encryption' })
  })
})

// Final review I2 (Ruling 4): el tour de Memories apunta al explorer y al grafo, que con
// Settings activa están montados pero ocultos.
describe('useMemoryTabs — pedido del grafo (arranca el tour de Memories)', () => {
  it('con Settings activa, un pedido nuevo activa Graph y deja Settings abierta', () => {
    const { result, rerender } = renderHook(({ g }) => useMemoryTabs(false, 1, g), { initialProps: { g: 0 } })
    expect(result.current.activeId).toBe('settings')
    rerender({ g: 1 })
    expect(result.current.activeId).toBe('graph')
    expect(result.current.tabs.some((t) => t.kind === 'settings')).toBe(true)
  })

  it('el mismo pedido no se atiende dos veces: reabrir no saca de Settings', () => {
    const a = renderHook(() => useMemoryTabs(false, 0, 1))
    expect(a.result.current.activeId).toBe('graph')
    act(() => { a.result.current.openSettings() })
    a.unmount()
    const b = renderHook(() => useMemoryTabs(false, 0, 1))
    expect(b.result.current.activeId).toBe('settings')
  })
})
