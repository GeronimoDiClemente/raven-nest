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

// El corte comercial (Task 1): `cloud` tiene que valer lo mismo que `pro` en todo el
// camino del plan mientras los dos conviven. Un perfil ya migrado a `cloud` que cayera a
// `free` le apagaria la nube al que paga.
describe('useProfile — el plan cloud', () => {
  const USER = { id: 'u-1' }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as unknown as { appFlags: unknown }).appFlags = { e2eBypass: false }
  })

  it('deja pasar un perfil guardado como cloud en vez de caerlo a free', async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: USER } })
    supabaseMock.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { plan: 'cloud', trial_started_at: null } }),
        }),
      }),
    }))

    const { result } = renderHook(() => useProfile())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.plan).toBe('cloud')
    expect(result.current.isTrialActive).toBe(false)
  })

  it('honra e2ePlan cloud bajo el bypass, como cualquier otro plan conocido', async () => {
    ;(window as unknown as { appFlags: unknown }).appFlags = { e2eBypass: true, e2ePlan: 'cloud' }

    const { result } = renderHook(() => useProfile())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.plan).toBe('cloud')
  })
})

describe('useProfile — período de facturación', () => {
  const USER = { id: 'u-1' }
  const select = vi.fn()

  function mockFila(data: unknown) {
    supabaseMock.getUser.mockResolvedValue({ data: { user: USER } })
    supabaseMock.from.mockImplementation(() => ({
      select: (cols: string) => {
        select(cols)
        return { eq: () => ({ maybeSingle: () => Promise.resolve({ data }) }) }
      },
    }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as unknown as { appFlags: unknown }).appFlags = { e2eBypass: false }
  })

  it('pide y mapea intervalo, fin y cancelación', async () => {
    mockFila({ plan: 'cloud', trial_started_at: null, billing_interval: 'annual', current_period_end: '2026-11-29T00:00:00Z', cancel_at_period_end: true })
    const { result } = renderHook(() => useProfile())
    await waitFor(() => expect(result.current.userId).toBe('u-1'))
    expect(select).toHaveBeenCalledWith('plan, trial_started_at, billing_interval, current_period_end, cancel_at_period_end')
    expect(result.current.billingInterval).toBe('annual')
    expect(result.current.currentPeriodEnd).toBe('2026-11-29T00:00:00Z')
    expect(result.current.cancelAtPeriodEnd).toBe(true)
  })

  it('sin fila: null, null, false', async () => {
    mockFila(null)
    const { result } = renderHook(() => useProfile())
    await waitFor(() => expect(result.current.userId).toBe('u-1'))
    expect(result.current.billingInterval).toBeNull()
    expect(result.current.currentPeriodEnd).toBeNull()
    expect(result.current.cancelAtPeriodEnd).toBe(false)
  })

  it('recargar vuelve a leer, respetando la lectura en vuelo', async () => {
    mockFila({ plan: 'free', trial_started_at: null })
    const { result } = renderHook(() => useProfile())
    await waitFor(() => expect(result.current.userId).toBe('u-1'))
    expect(supabaseMock.from).toHaveBeenCalledTimes(1)
    await act(async () => { result.current.recargar(); result.current.recargar() })
    await waitFor(() => expect(supabaseMock.from).toHaveBeenCalledTimes(2))
  })

  it('e2eBilling bajo el bypass alimenta el período; JSON inválido se ignora', async () => {
    const billing = { billingInterval: 'monthly', currentPeriodEnd: '2026-11-29T00:00:00Z', cancelAtPeriodEnd: false }
    ;(window as unknown as { appFlags: unknown }).appFlags = { e2eBypass: true, e2ePlan: 'cloud', e2eBilling: JSON.stringify(billing) }
    const a = renderHook(() => useProfile())
    await waitFor(() => expect(a.result.current.loading).toBe(false))
    expect(a.result.current.billingInterval).toBe('monthly')
    expect(a.result.current.currentPeriodEnd).toBe(billing.currentPeriodEnd)
    a.unmount()

    ;(window as unknown as { appFlags: unknown }).appFlags = { e2eBypass: true, e2ePlan: 'cloud', e2eBilling: '{no es json' }
    const b = renderHook(() => useProfile())
    await waitFor(() => expect(b.result.current.loading).toBe(false))
    expect(b.result.current.billingInterval).toBeNull()
  })

  it("'nest:e2e-plan' cambia el plan sólo con el bypass", async () => {
    ;(window as unknown as { appFlags: unknown }).appFlags = { e2eBypass: true, e2ePlan: 'free' }
    const a = renderHook(() => useProfile())
    await waitFor(() => expect(a.result.current.plan).toBe('free'))
    await act(async () => { window.dispatchEvent(new CustomEvent('nest:e2e-plan', { detail: { plan: 'cloud' } })) })
    expect(a.result.current.plan).toBe('cloud')
    expect(a.result.current.rawPlan).toBe('cloud')
    await act(async () => { window.dispatchEvent(new CustomEvent('nest:e2e-plan', { detail: { plan: 'diamante' } })) })
    expect(a.result.current.plan).toBe('cloud')
    // el foco (Playwright lo manda solo) no pisa el plan puesto por el evento
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(a.result.current.plan).toBe('cloud')
    expect(a.result.current.rawPlan).toBe('cloud')
    a.unmount()

    ;(window as unknown as { appFlags: unknown }).appFlags = { e2eBypass: false }
    supabaseMock.getUser.mockResolvedValue({ data: { user: null } })
    const b = renderHook(() => useProfile())
    await waitFor(() => expect(b.result.current.loading).toBe(false))
    await act(async () => { window.dispatchEvent(new CustomEvent('nest:e2e-plan', { detail: { plan: 'cloud' } })) })
    expect(b.result.current.plan).toBe('free')
  })
})
