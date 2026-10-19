import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TeamEncryptionCard from '../../components/TeamEncryptionCard'

const mockTeamConfig = vi.hoisted(() => ({
  activeTeam: { id: 'team-1', name: 'Equipo' },
  members: [
    { user_id: 'u-leader', role: 'leader' },
    { user_id: 'u-member', role: 'member' },
  ],
}))

vi.mock('../../hooks/useTeam', () => {
  return {
    useTeam: () => ({ activeTeam: mockTeamConfig.activeTeam, userId: 'u-leader', members: mockTeamConfig.members }),
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

  it('I4: al autorizar manda la huella que mostró, para que no se envuelva para otra clave', async () => {
    window.memory.teamEncryptionStatus = vi.fn().mockResolvedValue({
      activated: true, wrap: null, hasMaster: true, estadoRemotoLeido: true,
      pendingDevices: [{ deviceId: 'dev-1', name: 'Mi laptop', publicKey: 'key1' }],
      huellasPorDevice: { 'dev-1': 'AAAA-BBBB-CCCC-DDDD' },
    })
    window.memory.teamEncryptionAuthorize = vi.fn().mockResolvedValue({ ok: true })
    render(<TeamEncryptionCard />)
    fireEvent.click(await screen.findByRole('button', { name: /they match/i }))
    await waitFor(() => expect(window.memory.teamEncryptionAuthorize).toHaveBeenCalledWith('team-1', 'dev-1', 'AAAA-BBBB-CCCC-DDDD'))
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

describe('TeamEncryptionCard — huella propia (pending device)', () => {
  it('muestra la huella de esta máquina cuando espera ser autorizada', async () => {
    window.memory.teamEncryptionStatus = vi.fn().mockResolvedValue({
      activated: true,
      wrap: null,
      pendingDevices: [],
      hasMaster: false,
      estadoRemotoLeido: true,
      huellaPropia: 'XXXX-YYYY-ZZZZ-WWWW',
    })
    render(<TeamEncryptionCard />)
    expect(await screen.findByText('Before authorising from the other machine, check that it shows this same code:')).toBeInTheDocument()
    expect(await screen.findByText('XXXX-YYYY-ZZZZ-WWWW')).toBeInTheDocument()
  })
})

// Task 15 (review final): C1/I3 — la migración arranca sola al activar, y la tarjeta no dice
// que terminó mientras el servidor tenga filas de equipo en claro.
describe('TeamEncryptionCard — migración (Task 15)', () => {
  const activo = (extra: Record<string, unknown> = {}) => ({
    activated: true, wrap: null, pendingDevices: [], hasMaster: true, estadoRemotoLeido: true,
    hasPersonalKey: true, recryptPending: 0, ...extra,
  })

  it('después de activar dispara la migración sola', async () => {
    window.memory.teamEncryptionActivate = vi.fn().mockResolvedValue({ ok: true, recoveryCode: 'ABCD-EFGH-1234-5678-9012-3456' })
    window.memory.teamEncryptionRecrypt = vi.fn().mockResolvedValue({ total: 2, applied: 2, rejected: 0, remaining: 0 })
    render(<TeamEncryptionCard />)
    fireEvent.click(await screen.findByRole('button', { name: /turn on team encryption/i }))
    await waitFor(() => expect(window.memory.teamEncryptionRecrypt).toHaveBeenCalledWith('team-1'))
  })

  it('con filas en claro en el servidor muestra cuántas y no dice que terminó', async () => {
    window.memory.teamEncryptionStatus = vi.fn().mockResolvedValue(activo({ recryptPending: 3 }))
    render(<TeamEncryptionCard />)
    expect(await screen.findByText(/still unencrypted on the server/i)).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /encrypt them now/i })).toBeInTheDocument()
    expect(screen.queryByText(/all shared memories are encrypted/i)).not.toBeInTheDocument()
  })

  it('con 0 pendientes dice que todo lo compartido está cifrado', async () => {
    window.memory.teamEncryptionStatus = vi.fn().mockResolvedValue(activo({ recryptPending: 0 }))
    render(<TeamEncryptionCard />)
    expect(await screen.findByText(/all shared memories are encrypted/i)).toBeInTheDocument()
  })

  it('un error de la migración se muestra, con lo aplicado y lo que sigue pendiente', async () => {
    window.memory.teamEncryptionStatus = vi.fn().mockResolvedValue(activo({ recryptPending: 2 }))
    window.memory.teamEncryptionRecrypt = vi.fn().mockResolvedValue({
      total: 3, applied: 1, rejected: 0, remaining: 2, error: 'recrypt rejected: 500 internal_error',
    })
    render(<TeamEncryptionCard />)
    fireEvent.click(await screen.findByRole('button', { name: /encrypt them now/i }))
    expect(await screen.findByText(/recrypt rejected: 500/i)).toBeInTheDocument()
    expect(screen.getByText(/re-encrypted/i)).toBeInTheDocument()
    expect(screen.getByText(/still unencrypted on the server/i)).toBeInTheDocument()
  })
})

describe('TeamEncryptionCard — minors de la review final', () => {
  it('sin cifrado personal, pide activarlo primero en vez de esperar al leader', async () => {
    window.memory.teamEncryptionStatus = vi.fn().mockResolvedValue({
      activated: true, wrap: null, pendingDevices: [], hasMaster: false, estadoRemotoLeido: true, hasPersonalKey: false,
    })
    render(<TeamEncryptionCard />)
    expect(await screen.findByText(/turn on memory encryption for your account first/i)).toBeInTheDocument()
    expect(screen.queryByText(/ask your team leader to authorise this machine/i)).not.toBeInTheDocument()
  })

  it('si la clave ofrecida no es la del equipo, lo avisa', async () => {
    window.memory.teamEncryptionStatus = vi.fn().mockResolvedValue({
      activated: true, wrap: null, pendingDevices: [], hasMaster: false, estadoRemotoLeido: true, hasPersonalKey: true, keyMismatch: true,
    })
    render(<TeamEncryptionCard />)
    expect(await screen.findByText(/is not this team.s key/i)).toBeInTheDocument()
  })

  it('un member sin la clave no ve el código de recuperación (sólo el leader puede usarlo)', async () => {
    vi.resetModules()
    vi.doMock('../../hooks/useTeam', () => ({
      useTeam: () => ({ activeTeam: { id: 'team-1', name: 'Equipo' }, userId: 'u-member', members: [
        { user_id: 'u-leader', role: 'leader' }, { user_id: 'u-member', role: 'member' },
      ] }),
    }))
    window.memory.teamEncryptionStatus = vi.fn().mockResolvedValue({
      activated: true, wrap: null, pendingDevices: [], hasMaster: false, estadoRemotoLeido: true, hasPersonalKey: true,
    })
    const { default: Reimportado } = await import('../../components/TeamEncryptionCard')
    render(<Reimportado />)
    expect(await screen.findByText(/ask your team leader to authorise this machine/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /use the team recovery code/i })).not.toBeInTheDocument()
  })
})

// Follow-up del handoff 2026-10-15: lo retenido por falta de clave de equipo era invisible.
describe('TeamEncryptionCard — memorias retenidas en esta máquina', () => {
  const sinClave = (extra: Record<string, unknown> = {}) => ({
    activated: true, wrap: null, pendingDevices: [], hasMaster: false, estadoRemotoLeido: true, hasPersonalKey: true, ...extra,
  })

  it('sin autorizar, dice cuántas memorias de equipo esperan para subir', async () => {
    window.memory.teamEncryptionStatus = vi.fn().mockResolvedValue(sinClave({ heldCount: 3 }))
    render(<TeamEncryptionCard />)
    expect(await screen.findByText(/waiting on this machine until it is authorised/i)).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('una sola va en singular', async () => {
    window.memory.teamEncryptionStatus = vi.fn().mockResolvedValue(sinClave({ heldCount: 1 }))
    render(<TeamEncryptionCard />)
    expect(await screen.findByText(/team memory is waiting/i)).toBeInTheDocument()
  })

  it('con 0 no dice nada', async () => {
    window.memory.teamEncryptionStatus = vi.fn().mockResolvedValue(sinClave({ heldCount: 0 }))
    render(<TeamEncryptionCard />)
    expect(await screen.findByText(/this machine is not authorised yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/waiting on this machine/i)).not.toBeInTheDocument()
  })
})

describe('TeamEncryptionCard — truncation de nombres untrusted', () => {
  it('trunca nombres largos a 40 caracteres con ellipsis', async () => {
    const longName = 'a'.repeat(100)
    // Cambiar el activeTeam per-test usando la config hoisted
    mockTeamConfig.activeTeam = { id: 'team-1', name: longName }

    window.memory.teamEncryptionStatus = vi.fn().mockResolvedValue({ activated: false, wrap: null, pendingDevices: [], hasMaster: false })
    render(<TeamEncryptionCard />)
    const title = await screen.findByText(/Encrypt what/)
    expect(title).toBeInTheDocument()
    // Verificar que el nombre se truncó a 40 chars + ellipsis
    const span = title.querySelector('span.font-mono')
    expect(span).toBeInTheDocument()
    expect(span!.textContent).toBe('a'.repeat(40) + '…')
    expect(span!.textContent!.length).toBe(41)

    // Restaurar para otros tests
    mockTeamConfig.activeTeam = { id: 'team-1', name: 'Equipo' }
  })
})
