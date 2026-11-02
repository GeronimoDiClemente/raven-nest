import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CloudMemoryCard from '../../components/CloudMemoryCard'

// Mismo armado de mocks que CloudMemoryCard.test.tsx: supabase sin usuario y un puente
// `window.memory` a mano. Acá se prueba lo que la spec 2026-11-02 agrega: el código de
// recuperación, la espera de autorización y «Turn on encryption».
const supabaseMock = vi.hoisted(() => {
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
  }
  return {
    functions: { invoke: vi.fn() },
    auth: { getUser: vi.fn(), signOut: vi.fn(), getSession: vi.fn(), onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) },
    from: vi.fn(() => query),
  }
})
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

const statusDesconectado = { connected: false, deviceId: null, itemCount: 0, pendingCount: 0, daemonStatus: 'idle' }
const statusConectado = { connected: true, deviceId: 'dev-1', itemCount: 5, pendingCount: 0, daemonStatus: 'idle' }

const api = {
  ensureDeviceId: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  status: vi.fn(),
  hubStats: vi.fn(),
  registerDevice: vi.fn(),
  onStatus: vi.fn(),
  removeStatusListener: vi.fn(),
  doctor: vi.fn(),
  keepProject: vi.fn(),
  encryptionSecure: vi.fn(),
  encryptionConfirmRecoveryCode: vi.fn(),
  encryptionPendingRecoveryCode: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
  supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } })
  api.ensureDeviceId.mockResolvedValue('dev-1')
  api.hubStats.mockResolvedValue({ itemCount: 0, projectCount: 0 })
  api.registerDevice.mockResolvedValue({ ok: true, deviceId: 'dev-1', token: 'nmk_x' })
  api.doctor.mockResolvedValue({ ok: true, blockedTotal: 0, groups: [], localOnlyProjects: [] })
  api.keepProject.mockResolvedValue({ ok: true })
  api.status.mockResolvedValue(statusDesconectado)
  api.encryptionConfirmRecoveryCode.mockResolvedValue({ ok: true })
  api.encryptionPendingRecoveryCode.mockResolvedValue(null)
  ;(window as unknown as { memory: typeof api }).memory = api
  ;(window as unknown as { localPaths: unknown }).localPaths = { getAll: async () => ({}) }
})

afterEach(() => {
  delete (window as unknown as { memory?: unknown }).memory
})

describe('CloudMemoryCard — cifrado obligatorio', () => {
  it('al conectar una cuenta nueva muestra el código y Done exige el checkbox', async () => {
    api.connect.mockResolvedValue({ ok: true, itemCount: 3, cifrado: { estado: 'activada', recoveryCode: 'AAAA-BBBB', aviso: null } })
    render(<CloudMemoryCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('AAAA-BBBB')).toBeInTheDocument()
    const done = screen.getByRole('button', { name: 'Done' })
    expect(done).toBeDisabled()
    fireEvent.click(screen.getByLabelText('I have saved it somewhere safe'))
    fireEvent.click(done)
    await waitFor(() => expect(api.encryptionConfirmRecoveryCode).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText('AAAA-BBBB')).toBeNull())
  })

  it('segunda máquina: muestra la huella y la espera', async () => {
    api.connect.mockResolvedValue({ ok: true, itemCount: 0, cifrado: { estado: 'esperando-autorizacion', huella: 'ab12 cd34' } })
    render(<CloudMemoryCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    expect(await screen.findByText(/Approve this machine from one that already has the key/)).toBeInTheDocument()
    expect(screen.getByText('ab12 cd34')).toBeInTheDocument()
  })

  it('needs_encryption_setup: ofrece Turn on encryption, que llama a secure', async () => {
    api.status.mockResolvedValue({ ...statusConectado, daemonStatus: 'error', daemonStatusDetail: 'needs_encryption_setup' })
    api.encryptionSecure.mockResolvedValue({ estado: 'activada', recoveryCode: 'CCCC-DDDD', aviso: null })
    render(<CloudMemoryCard />)
    expect(await screen.findByText(/Cloud sync is paused until encryption is on/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on encryption' }))
    expect(await screen.findByText('CCCC-DDDD')).toBeInTheDocument()
  })

  it('con plaintextPending > 0 dice cuánto falta', async () => {
    api.status.mockResolvedValue({ ...statusConectado, plaintextPending: 12 })
    render(<CloudMemoryCard />)
    expect(await screen.findByText('Encrypting your cloud memory… 12 left')).toBeInTheDocument()
  })

  it('al montar recupera un código pendiente del main (cambió de pestaña)', async () => {
    api.encryptionPendingRecoveryCode.mockResolvedValue('EEEE-FFFF')
    render(<CloudMemoryCard />)
    expect(await screen.findByText('EEEE-FFFF')).toBeInTheDocument()
  })
})
