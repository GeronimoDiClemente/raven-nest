import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SyncTokenRow from '../../components/SyncTokenRow'

// CloudMemoryCard talks to supabase directly (via useMemory/useUserRepos/useProfile) —
// mocked the same way SettingsPanel.test.tsx does it, resolving no user so those effects
// bail out early without hitting the network.
const supabaseMock = vi.hoisted(() => {
  // useUserRepos encadena from().select().order() y lo await-ea. Con `from` devolviendo
  // undefined la promesa rechazaba y vitest contaba un unhandled error por test: no
  // rompian, pero un rechazo suelto puede enmascarar un fallo real.
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
  }
  return {
    auth: { getUser: vi.fn(), signOut: vi.fn(), getSession: vi.fn() },
    from: vi.fn(() => query),
  }
})
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

// Fix round 1 review, Finding 1 (Important): the token <input> used to require
// PLAN_LIMITS[plan].memoryCloud even in the `error` state. `error` is reachable
// while already connected (refresh() maps daemonStatus === 'error' to it), and
// useProfile() re-fetches plan on every window focus — so a Pro user downgraded
// to free while their daemon was erroring saw a permanently-disabled Retry
// button with no input to type a new token into, and no Disconnect escape
// hatch either. The fix widens the input's render condition so `error` always
// shows it, regardless of plan.
function mockMemoryBridge(status: {
  connected: boolean
  deviceId: string | null
  itemCount: number
  pendingCount: number
  daemonStatus: 'idle' | 'syncing' | 'paused' | 'error' | 'plan_required'
  // El código del último cambio de estado del daemon ('offline', 'lock_held', ...). Es lo
  // que deja distinguir DOS motivos distintos para el mismo 'paused'.
  daemonStatusDetail?: string
  quota?: { used_bytes: number; max_bytes: number }
}) {
  const memory = {
    ensureDeviceId: vi.fn().mockResolvedValue('dev-1'),
    connect: vi.fn().mockResolvedValue({ ok: true }),
    disconnect: vi.fn().mockResolvedValue({ ok: true }),
    status: vi.fn().mockResolvedValue(status),
    hubStats: vi.fn().mockResolvedValue({ itemCount: 0, projectCount: 0 }),
    registerDevice: vi.fn().mockResolvedValue({ ok: true, deviceId: 'dev-1', token: 'nmk_del_servicio' }),
    onStatus: vi.fn(),
    removeStatusListener: vi.fn(),
  }
  ;(window as unknown as { memory: typeof memory }).memory = memory
  return memory
}

function mockLocalPaths() {
  ;(window as unknown as { localPaths: { getAll: () => Promise<Record<string, string>> } })
    .localPaths = { getAll: async () => ({}) }
}

describe('SyncTokenRow (Advanced)', () => {
  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-de-login' } } })
    mockLocalPaths()
  })
  afterEach(() => { delete (window as unknown as { memory?: unknown }).memory })

  // C7 fix round 1: en `error` (al que se llega conectado) el campo tiene que estar aunque el
  // plan ya no incluya nube — si no, no hay forma de pegar un token nuevo.
  it('en error el campo está aunque el plan no tenga nube', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 0, pendingCount: 0, daemonStatus: 'error' })
    render(<SyncTokenRow />)
    expect(await screen.findByPlaceholderText('Paste a sync token')).toBeInTheDocument()
    expect(screen.getByText('Connect with a token instead of signing in.')).toBeInTheDocument()
  })

  it('con un token pegado conecta con ese y no le pide uno al servicio', async () => {
    const memoria = mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 0, pendingCount: 0, daemonStatus: 'error' })
    render(<SyncTokenRow />)
    fireEvent.change(await screen.findByPlaceholderText('Paste a sync token'), { target: { value: 'nmk_a_mano' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(memoria.connect).toHaveBeenCalledWith('nmk_a_mano', expect.anything()))
    expect(memoria.registerDevice).not.toHaveBeenCalled()
  })

  it('Connect está apagado sin token', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'dev-1', itemCount: 0, pendingCount: 0, daemonStatus: 'error' })
    render(<SyncTokenRow />)
    await screen.findByPlaceholderText('Paste a sync token')
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
  })

  it('conectado no se muestra', async () => {
    mockMemoryBridge({ connected: true, deviceId: 'd', itemCount: 3, pendingCount: 0, daemonStatus: 'idle' })
    const { container } = render(<SyncTokenRow />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  // Spec 2b-1 §4.1: Free conecta, así que también puede conectar con un token.
  it('Free desconectado ve el campo', async () => {
    mockMemoryBridge({ connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' })
    render(<SyncTokenRow />)
    expect(await screen.findByPlaceholderText('Paste a sync token')).toBeInTheDocument()
  })
})
