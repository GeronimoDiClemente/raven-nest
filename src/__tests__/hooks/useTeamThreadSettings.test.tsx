// Task 2 (mirar vs. configurar): la parte de TeamThreadPanel.load que resuelve projectKey
// y lee settings.enabled, mas handleToggle, ahora vive aca — compartida entre el panel
// (que sigue leyendo ramas) y TeamThreadToggle (que no las necesita).
import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTeamThreadSettings } from '../../hooks/useTeamThreadSettings'

beforeEach(() => {
  ;(window as any).memory = {
    teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: true, projectKey: 'pk' }),
    teamThreadGetSettings: vi.fn().mockResolvedValue({ ok: true, settings: { enabled: false } }),
    teamThreadSetSettings: vi.fn().mockResolvedValue({ ok: true }),
  }
})

describe('useTeamThreadSettings', () => {
  it('lee el estado del repo', async () => {
    const { result } = renderHook(() => useTeamThreadSettings('/repo'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.enabled).toBe(false)
    expect(result.current.projectKey).toBe('pk')
  })
  it('prender escribe y refleja', async () => {
    const { result } = renderHook(() => useTeamThreadSettings('/repo'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(() => result.current.setEnabled(true))
    expect((window as any).memory.teamThreadSetSettings).toHaveBeenCalledWith('pk', '/repo', { enabled: true })
    expect(result.current.enabled).toBe(true)
  })
  it('un rechazo de main muestra su mensaje y no cambia el estado', async () => {
    ;(window as any).memory.teamThreadSetSettings.mockResolvedValue({ ok: false, message: 'Your plan does not include it' })
    const { result } = renderHook(() => useTeamThreadSettings('/repo'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(() => result.current.setEnabled(true))
    expect(result.current.enabled).toBe(false)
    expect(result.current.error).toBe('Your plan does not include it')
  })
  it('cargaFallida distingue la lectura rota del rechazo al cambiar (D4)', async () => {
    ;(window as any).memory.teamThreadSetSettings.mockResolvedValue({ ok: false, message: 'Your plan does not include it' })
    const { result } = renderHook(() => useTeamThreadSettings('/repo'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.cargaFallida).toBe(false)
    await act(() => result.current.setEnabled(true))
    expect(result.current.error).toBe('Your plan does not include it')
    expect(result.current.cargaFallida).toBe(false)
  })
  it('una lectura que falla marca cargaFallida', async () => {
    ;(window as any).memory.teamThreadGetSettings.mockResolvedValue({ ok: false })
    const { result } = renderHook(() => useTeamThreadSettings('/repo'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.cargaFallida).toBe(true)
  })
  it('sin repo no consulta nada', async () => {
    const { result } = renderHook(() => useTeamThreadSettings(null))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect((window as any).memory.teamThreadProjectKeyForWorktree).not.toHaveBeenCalled()
  })
})
