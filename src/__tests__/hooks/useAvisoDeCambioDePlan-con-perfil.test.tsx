// Rulings P3 y P4 (plan 2b-2): el aviso conectado al useProfile real, como lo usa App.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useProfile } from '../../hooks/useProfile'
import { useAvisoDeCambioDePlan } from '../../hooks/useAvisoDeCambioDePlan'

const supabaseMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getUser: supabaseMock.getUser }, from: supabaseMock.from },
}))

// Cada lectura de `profiles` devuelve la siguiente fila de la lista (la última se repite).
function mockFilas(filas: Array<{ plan: string; trial_started_at: string | null }>) {
  let i = 0
  supabaseMock.from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve({ data: filas[Math.min(i++, filas.length - 1)] }) }),
    }),
  }))
}

let refreshStatus: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { appFlags: unknown }).appFlags = { e2eBypass: false }
  refreshStatus = vi.fn().mockResolvedValue({ ok: true })
  ;(window as unknown as { memory: unknown }).memory = { refreshStatus }
})

const montar = () => renderHook(() => {
  const perfil = useProfile()
  return { perfil, aviso: useAvisoDeCambioDePlan(perfil.rawPlan, perfil.loading, perfil.userId) }
})

const volverAlFoco = () => act(async () => { window.dispatchEvent(new Event('focus')) })

describe('el aviso de Cloud activo con el perfil real', () => {
  // P3: durante el trial el plan efectivo es `team`; pagar Cloud igual es una activación.
  it('un free en trial (efectivo team) que paga Cloud ve el aviso', async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: 'u-1' } } })
    const recien = new Date().toISOString()
    mockFilas([
      { plan: 'free', trial_started_at: recien },
      { plan: 'cloud', trial_started_at: recien },
    ])
    const { result } = montar()
    await waitFor(() => expect(result.current.perfil.loading).toBe(false))
    expect(result.current.perfil.plan).toBe('team')
    expect(result.current.perfil.rawPlan).toBe('free')

    await volverAlFoco()
    await waitFor(() => expect(result.current.perfil.rawPlan).toBe('cloud'))
    expect(result.current.aviso.avisoVisible).toBe(true)
    expect(refreshStatus).toHaveBeenCalledTimes(1)
  })

  // P4: arrancar deslogueado y loguearse en una cuenta que ya es Cloud no la "activa".
  it('deslogueado y después login en una cuenta que ya es cloud: sin aviso', async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: null } })
    mockFilas([{ plan: 'cloud', trial_started_at: null }])
    const { result } = montar()
    await waitFor(() => expect(result.current.perfil.loading).toBe(false))
    expect(result.current.perfil.plan).toBe('free')

    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: 'u-cloud' } } })
    await volverAlFoco()
    await waitFor(() => expect(result.current.perfil.rawPlan).toBe('cloud'))
    expect(result.current.aviso.avisoVisible).toBe(false)
    expect(refreshStatus).not.toHaveBeenCalled()
  })
})
