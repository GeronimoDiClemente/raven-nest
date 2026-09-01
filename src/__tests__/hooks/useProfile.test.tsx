import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useProfile } from '../../hooks/useProfile'

// Supabase mockeado: por defecto sin usuario (como una sesión bypass real).
const supabaseMock = vi.hoisted(() => ({
  getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
  from: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getUser: supabaseMock.getUser }, from: supabaseMock.from },
}))

// El override e2ePlan permite a demos/E2E (RAVEN_E2E=1) probar features
// gateadas por plan sin un perfil Supabase real. Gateado DOBLE: solo aplica
// si e2eBypass también está activo — jamás en una sesión de producción.
describe('useProfile — override e2ePlan (solo bypass)', () => {
  const originalFlags = window.appFlags

  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { (window as { appFlags?: unknown }).appFlags = originalFlags })

  it('honors e2ePlan when the e2e bypass is active, without touching supabase', async () => {
    ;(window as unknown as { appFlags: unknown }).appFlags = { e2eBypass: true, e2ePlan: 'team' }
    const { result } = renderHook(() => useProfile())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.plan).toBe('team')
    expect(supabaseMock.getUser).not.toHaveBeenCalled()
  })

  it('ignores e2ePlan when the bypass flag is off', async () => {
    ;(window as unknown as { appFlags: unknown }).appFlags = { e2eBypass: false, e2ePlan: 'team' }
    const { result } = renderHook(() => useProfile())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.plan).toBe('free')
  })

  it('ignores an e2ePlan that is not a known plan', async () => {
    ;(window as unknown as { appFlags: unknown }).appFlags = { e2eBypass: true, e2ePlan: 'diamante' }
    const { result } = renderHook(() => useProfile())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.plan).toBe('free')
  })
})

// Un pago exitoso lo escribe el webhook de Stripe directo en `profiles`. El hook
// leia una sola vez al montar, asi que el que pagaba seguia viendo su plan viejo
// hasta reiniciar la app — y la compra parecia no haber funcionado.
describe('useProfile — se entera de un cambio de plan sin reiniciar', () => {
  const USER = { id: 'u-1' }

  function mockPerfil(planes: string[]) {
    let i = 0
    supabaseMock.getUser.mockResolvedValue({ data: { user: USER } })
    supabaseMock.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: { plan: planes[Math.min(i++, planes.length - 1)], trial_started_at: null },
          }),
        }),
      }),
    }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as unknown as { appFlags: unknown }).appFlags = { e2eBypass: false }
  })

  it('re-lee el plan cuando la ventana vuelve a tener foco', async () => {
    mockPerfil(['free', 'pro'])
    const { result } = renderHook(() => useProfile())
    await waitFor(() => expect(result.current.plan).toBe('free'))

    // el usuario se fue al navegador a pagar y volvio a la app
    await act(async () => { window.dispatchEvent(new Event('focus')) })

    await waitFor(() => expect(result.current.plan).toBe('pro'))
  })

  it('no consulta de nuevo si ya hay una lectura en vuelo', async () => {
    mockPerfil(['free'])
    renderHook(() => useProfile())
    await waitFor(() => expect(supabaseMock.from).toHaveBeenCalledTimes(1))

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('focus'))
    })
    // tres focos seguidos = una sola lectura extra, no tres
    await waitFor(() => expect(supabaseMock.from).toHaveBeenCalledTimes(2))
  })

  it('sin sesion no consulta el perfil al volver el foco', async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: null } })
    const { result } = renderHook(() => useProfile())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })
})
