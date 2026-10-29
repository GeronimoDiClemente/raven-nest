import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import AccountPlanSection from '../../components/account/AccountPlanSection'
import type { MaquinaDeLaCuenta } from '../../types'

// La sección lee dos hooks; acá se fingen los dos para dibujar cada estado sin red ni daemon.
const supabaseMock = vi.hoisted(() => ({
  functions: { invoke: vi.fn() },
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }), signOut: vi.fn(), getSession: vi.fn() },
  from: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

const perfil = vi.hoisted(() => ({ actual: {} as Record<string, unknown> }))
vi.mock('../../hooks/useProfile', () => ({ useProfile: () => perfil.actual }))

const memoria = vi.hoisted(() => ({ actual: {} as Record<string, unknown> }))
vi.mock('../../hooks/useMemory', () => ({ useMemory: () => memoria.actual }))

const portal = vi.hoisted(() => ({ abrirPortal: vi.fn() }))
vi.mock('../../lib/checkout', async (orig) => ({
  ...(await orig<typeof import('../../lib/checkout')>()),
  abrirPortal: portal.abrirPortal,
}))

vi.mock('../../components/UpgradeModal', () => ({
  default: () => <div data-testid="upgrade-modal" />,
}))

const DIA = 86_400_000
const recargar = vi.fn()

function fingirPerfil(p: Partial<Record<string, unknown>> = {}) {
  perfil.actual = {
    plan: 'free', rawPlan: 'free', loading: false, isTrialActive: false, trialDaysLeft: 0, userId: 'u1',
    billingInterval: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, recargar, ...p,
  }
}

function fingirMemoria(m: Partial<Record<string, unknown>> = {}) {
  memoria.actual = {
    state: 'connected', error: null, cloudProjects: [{ projectKey: 'k-rn', name: 'raven-nest' }],
    limits: { max_projects: 1 }, localOnlyProjects: [], overLimit: false, ...m,
  }
}

const MAQUINAS: MaquinaDeLaCuenta[] = [
  { id: 'd1', name: 'Gero-PC', platform: 'win32', lastSeenAt: Date.now(), current: true },
  { id: 'd2', name: 'MacBook', platform: 'darwin', lastSeenAt: Date.now() - 3 * DIA, current: false },
  { id: 'd3', name: 'build-vm', platform: 'linux', lastSeenAt: null, current: false },
]

function fingirPuente(lista: MaquinaDeLaCuenta[] = MAQUINAS) {
  const memory = {
    devices: vi.fn().mockResolvedValue({ ok: true, devices: lista }),
    revokeDevice: vi.fn().mockResolvedValue({ ok: true }),
  }
  ;(window as unknown as { memory: typeof memory }).memory = memory
  return memory
}

const enFuturo = (dias: number) => new Date(Date.now() + dias * DIA).toISOString()

beforeEach(() => {
  recargar.mockReset()
  portal.abrirPortal.mockReset()
  fingirPerfil()
  fingirMemoria()
})
afterEach(() => {
  delete (window as unknown as { memory?: unknown }).memory
})

describe('AccountPlanSection — Plan', () => {
  it('Free: el detalle y Upgrade abre el UpgradeModal', () => {
    fingirPuente()
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    expect(screen.getByText('Free')).toBeTruthy()
    expect(screen.getByText('1 project in the cloud. Cloud syncs all of them.')).toBeTruthy()
    expect(screen.queryByTestId('upgrade-modal')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(screen.getByTestId('upgrade-modal')).toBeTruthy()
  })

  it('Cloud renovando: Renews on y Manage subscription abre el portal', async () => {
    fingirPuente()
    fingirPerfil({ plan: 'cloud', rawPlan: 'cloud', billingInterval: 'monthly', currentPeriodEnd: '2099-11-29T12:00:00Z' })
    portal.abrirPortal.mockResolvedValue({ ok: true })
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    expect(screen.getByText('Cloud · Monthly')).toBeTruthy()
    expect(screen.getByText('Renews on Nov 29, 2099')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Manage subscription' }))
    await waitFor(() => expect(portal.abrirPortal).toHaveBeenCalledTimes(1))
  })

  it('Cloud cancelando', () => {
    fingirPuente()
    fingirPerfil({ plan: 'cloud', rawPlan: 'cloud', billingInterval: 'annual', currentPeriodEnd: '2099-11-29T12:00:00Z', cancelAtPeriodEnd: true })
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    expect(screen.getByText('Cloud · Annual')).toBeTruthy()
    expect(screen.getByText('Cancels on Nov 29, 2099 — you keep Cloud until then.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeTruthy()
  })

  it('Cloud sin fecha: no inventa una línea', () => {
    fingirPuente()
    fingirPerfil({ plan: 'cloud', rawPlan: 'cloud' })
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    expect(screen.getByText('Cloud')).toBeTruthy()
    expect(screen.queryByText(/Renews on|Cancels on/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeTruthy()
  })

  it('un error del portal se muestra en rojo', async () => {
    fingirPuente()
    fingirPerfil({ plan: 'cloud', rawPlan: 'cloud', currentPeriodEnd: enFuturo(10) })
    portal.abrirPortal.mockResolvedValue({ ok: false, error: 'Portal roto.', code: null })
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Manage subscription' }))
    const err = await screen.findByText('Portal roto.')
    expect(err.className).toContain('text-destructive')
    expect(recargar).not.toHaveBeenCalled()
  })

  it('no_subscription: muestra el error y relee el perfil una vez', async () => {
    fingirPuente()
    fingirPerfil({ plan: 'cloud', rawPlan: 'cloud' })
    portal.abrirPortal.mockResolvedValue({ ok: false, error: 'Sin suscripción.', code: 'no_subscription' })
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Manage subscription' }))
    await screen.findByText('Sin suscripción.')
    expect(recargar).toHaveBeenCalledTimes(1)
  })

  it('cargando: esqueleto, nunca Free', () => {
    fingirPuente()
    fingirPerfil({ loading: true })
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    expect(screen.getByTestId('plan-cargando')).toBeTruthy()
    expect(screen.queryByText('Free')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })
})

describe('AccountPlanSection — Usage', () => {
  it('proyectos, solo locales que abren Memory settings y máquinas conectadas', async () => {
    fingirPuente()
    fingirMemoria({
      localOnlyProjects: [{ projectKey: 'k-a', name: 'a', count: 1 }, { projectKey: 'k-b', name: 'b', count: 2 }],
    })
    const onOpen = vi.fn()
    render(<AccountPlanSection onOpenMemorySync={onOpen} />)
    expect(screen.getByText('Projects in the cloud')).toBeTruthy()
    expect(screen.getByText('1 of 1 · raven-nest')).toBeTruthy()
    fireEvent.click(screen.getByText('2 local only — Keep syncing in Memory settings ›'))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('3 connected')).toBeTruthy()
  })

  it('sin solo locales no hay segunda línea', async () => {
    fingirPuente()
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    await screen.findByText('3 connected')
    expect(screen.queryByText(/local only/)).toBeNull()
  })

  it('sync apagado: el aviso y no pide máquinas', () => {
    const puente = fingirPuente()
    fingirMemoria({ state: 'disconnected', cloudProjects: null })
    const onOpen = vi.fn()
    render(<AccountPlanSection onOpenMemorySync={onOpen} />)
    expect(screen.getByText('Cloud sync is off.')).toBeTruthy()
    fireEvent.click(screen.getByText('Turn on in Memory settings ›'))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(puente.devices).not.toHaveBeenCalled()
    expect(screen.queryByText('Projects in the cloud')).toBeNull()
  })

  it('beta: invite-only', () => {
    const puente = fingirPuente()
    fingirMemoria({ state: 'error', error: 'not_in_beta', cloudProjects: null })
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    expect(screen.getByText('Cloud sync is invite-only during the beta.')).toBeTruthy()
    expect(puente.devices).not.toHaveBeenCalled()
  })

  it('pide las máquinas cuando el sync pasa a conectado', async () => {
    const puente = fingirPuente()
    fingirMemoria({ state: 'connecting', cloudProjects: null })
    const { rerender } = render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    expect(puente.devices).not.toHaveBeenCalled()
    fingirMemoria()
    rerender(<AccountPlanSection onOpenMemorySync={() => {}} />)
    await waitFor(() => expect(puente.devices).toHaveBeenCalledTimes(1))
  })
})

describe('AccountPlanSection — Machines', () => {
  const fila = (nombre: string) => screen.getByText(nombre).closest('[data-slot="setting-row"]') as HTMLElement

  it('las filas, la actual sin Disconnect, y el pie', async () => {
    fingirPuente()
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    await screen.findByText('Gero-PC')
    expect(within(fila('Gero-PC')).getByText('Windows · This machine')).toBeTruthy()
    expect(within(fila('Gero-PC')).queryByRole('button')).toBeNull()
    expect(within(fila('MacBook')).getByText('macOS · last seen 3d ago')).toBeTruthy()
    expect(within(fila('MacBook')).getByRole('button', { name: 'Disconnect' })).toBeTruthy()
    expect(within(fila('build-vm')).getByText('Linux · last seen never')).toBeTruthy()
    expect(screen.getByText('Disconnecting stops syncing on that machine. Memory it already downloaded stays there.')).toBeTruthy()
  })

  it('plataforma null omite el segmento; una rara va tal cual', async () => {
    fingirPuente([
      { id: 'x', name: 'Raro', platform: null, lastSeenAt: null, current: false },
      { id: 'y', name: 'Bsd', platform: 'freebsd', lastSeenAt: null, current: false },
    ])
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    await screen.findByText('Raro')
    expect(within(fila('Raro')).getByText('last seen never')).toBeTruthy()
    expect(within(fila('Bsd')).getByText('freebsd · last seen never')).toBeTruthy()
  })

  it('la actual nunca muestra Disconnect, aunque sea la única', async () => {
    fingirPuente([MAQUINAS[0]])
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    await screen.findByText('Gero-PC')
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull()
  })

  it('confirmación en línea: Cancel vuelve sin llamar', async () => {
    const puente = fingirPuente()
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    await screen.findByText('MacBook')
    fireEvent.click(within(fila('MacBook')).getByRole('button', { name: 'Disconnect' }))
    expect(screen.getByText('Disconnect MacBook?')).toBeTruthy()
    fireEvent.click(within(fila('MacBook')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Disconnect MacBook?')).toBeNull()
    expect(puente.revokeDevice).not.toHaveBeenCalled()
  })

  it('confirmar dos veces revoca una sola; deshabilitado en vuelo; al volver sale de la lista', async () => {
    const puente = fingirPuente()
    let soltar: (v: { ok: true }) => void = () => {}
    puente.revokeDevice.mockReturnValue(new Promise((r) => { soltar = r }))
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    await screen.findByText('MacBook')
    fireEvent.click(within(fila('MacBook')).getByRole('button', { name: 'Disconnect' }))
    const confirmar = within(fila('MacBook')).getByRole('button', { name: 'Disconnect' })
    fireEvent.click(confirmar)
    fireEvent.click(confirmar)
    expect(puente.revokeDevice).toHaveBeenCalledTimes(1)
    expect(puente.revokeDevice).toHaveBeenCalledWith('d2')
    expect((confirmar as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { soltar({ ok: true }) })
    await waitFor(() => expect(screen.queryByText('MacBook')).toBeNull())
    expect(screen.getByText('2 connected')).toBeTruthy()
  })

  it('error al desconectar: mensaje y la fila sigue', async () => {
    const puente = fingirPuente()
    puente.revokeDevice.mockResolvedValue({ ok: false, error: 'offline' })
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    await screen.findByText('MacBook')
    fireEvent.click(within(fila('MacBook')).getByRole('button', { name: 'Disconnect' }))
    fireEvent.click(within(fila('MacBook')).getByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByText("Couldn't disconnect MacBook. Try again.")).toBeTruthy()
    expect(screen.getByText('MacBook')).toBeTruthy()
  })

  it.each(['not_found', 'account_changed'])('%s vuelve a pedir la lista', async (codigo) => {
    const puente = fingirPuente()
    puente.revokeDevice.mockResolvedValue({ ok: false, error: codigo })
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    await screen.findByText('MacBook')
    expect(puente.devices).toHaveBeenCalledTimes(1)
    puente.devices.mockResolvedValue({ ok: true, devices: [MAQUINAS[0]] })
    fireEvent.click(within(fila('MacBook')).getByRole('button', { name: 'Disconnect' }))
    fireEvent.click(within(fila('MacBook')).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(puente.devices).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('MacBook')).toBeNull())
  })

  it('error al cargar: Retry vuelve a pedir y Usage sigue', async () => {
    const puente = fingirPuente()
    puente.devices.mockResolvedValueOnce({ ok: false, error: 'offline' })
    render(<AccountPlanSection onOpenMemorySync={() => {}} />)
    expect(await screen.findByText("Couldn't load your machines.")).toBeTruthy()
    expect(screen.getByText('1 of 1 · raven-nest')).toBeTruthy()
    expect(screen.queryByText(/connected$/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Gero-PC')).toBeTruthy()
    expect(puente.devices).toHaveBeenCalledTimes(2)
  })
})
