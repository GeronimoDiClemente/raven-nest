import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TeamEncryptionCard from '../../components/TeamEncryptionCard'

vi.mock('../../hooks/useTeam', () => {
  const mockActiveTeam = { id: 'team-1', name: 'Equipo' }
  const mockMembers = [
    { user_id: 'u-leader', role: 'leader' },
    { user_id: 'u-member', role: 'member' },
  ]
  return {
    useTeam: () => ({ activeTeam: mockActiveTeam, userId: 'u-leader', members: mockMembers }),
  }
})

beforeEach(() => {
  window.memory = {
    teamEncryptionStatus: vi.fn().mockResolvedValue({ activated: false, wrap: null, pendingDevices: [], hasMaster: false }),
  } as never
})

describe('TeamEncryptionCard', () => {
  it('el leader ve el botón de activar cuando el equipo no tiene clave', async () => {
    render(<TeamEncryptionCard />)
    expect(await screen.findByRole('button', { name: /turn on team encryption/i })).toBeInTheDocument()
  })

  it('al activar muestra el código de recuperación una vez', async () => {
    window.memory.teamEncryptionActivate = vi.fn().mockResolvedValue({ ok: true, recoveryCode: 'ABCD-EFGH-1234-5678-9012-3456' })
    render(<TeamEncryptionCard />)
    fireEvent.click(await screen.findByRole('button', { name: /turn on team encryption/i }))
    expect(await screen.findByText('ABCD-EFGH-1234-5678-9012-3456')).toBeInTheDocument()
  })
})

describe('TeamEncryptionCard — adopción automática', () => {
  it('si el equipo está activado y esta máquina no tiene la clave, adopta sola al montar', async () => {
    window.memory.teamEncryptionStatus = vi.fn()
      .mockResolvedValueOnce({ activated: true, wrap: null, pendingDevices: [], hasMaster: false })
      .mockResolvedValueOnce({ activated: true, wrap: null, pendingDevices: [], hasMaster: true })
    window.memory.teamEncryptionAdopt = vi.fn().mockResolvedValue({ ok: true, adoptada: true })
    render(<TeamEncryptionCard />)
    await waitFor(() => expect(window.memory.teamEncryptionAdopt).toHaveBeenCalledWith('team-1'))
    expect(await screen.findByText(/team encryption on/i)).toBeInTheDocument()
  })
})

describe('TeamEncryptionCard — un member (no leader)', () => {
  it('no ofrece activar, sólo informa que falta el leader', async () => {
    vi.resetModules()
    vi.doMock('../../hooks/useTeam', () => ({
      useTeam: () => ({ activeTeam: { id: 'team-1', name: 'Equipo' }, userId: 'u-member', members: [
        { user_id: 'u-leader', role: 'leader' }, { user_id: 'u-member', role: 'member' },
      ] }),
    }))
    const { default: TeamEncryptionCardReimportado } = await import('../../components/TeamEncryptionCard')
    render(<TeamEncryptionCardReimportado />)
    expect(await screen.findByText(/ask your team leader to turn on encryption/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /turn on team encryption/i })).not.toBeInTheDocument()
  })
})

describe('TeamEncryptionCard — huellas de dispositivos pendientes', () => {
  it('muestra la huella de cada dispositivo pendiente con instrucción', async () => {
    window.memory.teamEncryptionStatus = vi.fn().mockResolvedValue({
      activated: true,
      wrap: null,
      pendingDevices: [{ deviceId: 'dev-1', name: 'Mi laptop', publicKey: 'key1' }],
      hasMaster: true,
      estadoRemotoLeido: true,
      huellasPorDevice: { 'dev-1': 'AAAA-BBBB-CCCC-DDDD' },
    })
    render(<TeamEncryptionCard />)
    expect(await screen.findByText('Authorise it only if that machine shows exactly this code:')).toBeInTheDocument()
    expect(await screen.findByText('AAAA-BBBB-CCCC-DDDD')).toBeInTheDocument()
  })
})

describe('TeamEncryptionCard — estado remoto desconocido', () => {
  it('no ofrece activar cuando no se pudo leer el estado del servidor', async () => {
    window.memory.teamEncryptionStatus = vi.fn().mockResolvedValue({
      activated: false,
      wrap: null,
      pendingDevices: [],
      hasMaster: false,
      estadoRemotoLeido: false,
    })
    render(<TeamEncryptionCard />)
    expect(await screen.findByText(/could not read this team.*s encryption state/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /turn on team encryption/i })).not.toBeInTheDocument()
  })
})
