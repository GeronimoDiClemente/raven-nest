import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
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
