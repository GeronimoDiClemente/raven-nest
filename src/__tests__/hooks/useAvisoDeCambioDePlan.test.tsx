// Spec 2b-2 §4.8: el toast de activación y el status nuevo al cambiar de plan.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAvisoDeCambioDePlan } from '../../hooks/useAvisoDeCambioDePlan'

let refreshStatus: ReturnType<typeof vi.fn>

beforeEach(() => {
  refreshStatus = vi.fn().mockResolvedValue({ ok: true })
  ;(window as unknown as { memory: unknown }).memory = { refreshStatus }
})
afterEach(() => { vi.useRealTimers() })

const montar = (plan: string, cargando: boolean) =>
  renderHook(({ plan, cargando }) => useAvisoDeCambioDePlan(plan, cargando), { initialProps: { plan, cargando } })

describe('useAvisoDeCambioDePlan', () => {
  // Review Focus 1: useProfile arranca en 'free' cargando y después lee 'cloud'.
  it('el arranque de una cuenta que ya es Cloud no muestra el aviso ni pide status', () => {
    const { result, rerender } = montar('free', true)
    rerender({ plan: 'cloud', cargando: false })
    expect(result.current.avisoVisible).toBe(false)
    expect(refreshStatus).not.toHaveBeenCalled()
  })

  it('de free a cloud (relectura por foco): aviso y status nuevo', () => {
    const { result, rerender } = montar('free', false)
    rerender({ plan: 'cloud', cargando: false })
    expect(result.current.avisoVisible).toBe(true)
    expect(refreshStatus).toHaveBeenCalledTimes(1)
  })

  it('de cloud a free: status nuevo, sin aviso', () => {
    const { result, rerender } = montar('cloud', false)
    rerender({ plan: 'free', cargando: false })
    expect(result.current.avisoVisible).toBe(false)
    expect(refreshStatus).toHaveBeenCalledTimes(1)
  })

  it('el aviso se cierra a mano o solo a los 8 s', () => {
    vi.useFakeTimers()
    const { result, rerender } = montar('free', false)
    rerender({ plan: 'cloud', cargando: false })
    act(() => { result.current.cerrarAviso() })
    expect(result.current.avisoVisible).toBe(false)

    rerender({ plan: 'free', cargando: false })
    rerender({ plan: 'cloud', cargando: false })
    expect(result.current.avisoVisible).toBe(true)
    act(() => { vi.advanceTimersByTime(8000) })
    expect(result.current.avisoVisible).toBe(false)
  })

  it('sin window.memory (preload viejo) no explota', () => {
    ;(window as unknown as { memory: unknown }).memory = undefined
    const { result, rerender } = montar('free', false)
    rerender({ plan: 'cloud', cargando: false })
    expect(result.current.avisoVisible).toBe(true)
  })

  // Ruling P4: la primera lectura de OTRO usuario es línea de base, no un cambio.
  describe('al cambiar de usuario', () => {
    const conUsuario = (plan: string, usuario: string | null) =>
      renderHook(({ plan, usuario }) => useAvisoDeCambioDePlan(plan, false, usuario), { initialProps: { plan, usuario } })

    it('deslogueado en free y entra una cuenta que ya es cloud: sin aviso ni status', () => {
      const { result, rerender } = conUsuario('free', null)
      rerender({ plan: 'cloud', usuario: 'u-cloud' })
      expect(result.current.avisoVisible).toBe(false)
      expect(refreshStatus).not.toHaveBeenCalled()
    })

    it('de una cuenta cloud a otra free: no es una baja', () => {
      const { rerender } = conUsuario('cloud', 'u-1')
      rerender({ plan: 'free', usuario: 'u-2' })
      expect(refreshStatus).not.toHaveBeenCalled()
    })

    it('después de la línea de base, el mismo usuario pagando sí avisa', () => {
      const { result, rerender } = conUsuario('free', null)
      rerender({ plan: 'free', usuario: 'u-1' })
      rerender({ plan: 'cloud', usuario: 'u-1' })
      expect(result.current.avisoVisible).toBe(true)
      expect(refreshStatus).toHaveBeenCalledTimes(1)
    })
  })
})
