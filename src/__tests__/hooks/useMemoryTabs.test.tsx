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
