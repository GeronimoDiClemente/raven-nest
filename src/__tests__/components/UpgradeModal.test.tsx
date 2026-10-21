// El modal de planes. Desde 2b-2 Cloud se cobra mensual o anual, y quien ya paga Cloud ve
// «Manage subscription» (el portal de Stripe) en vez de «Current plan».
//
// `UpgradeModal` es un default export sin prop `open` (se monta condicionalmente), y "Book a
// demo" es un <button> que abre el navegador por `electronShell.openExternal`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const supabaseMock = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  functions: { invoke: vi.fn() },
}))
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

import UpgradeModal from '../../components/UpgradeModal'

let openExternal: ReturnType<typeof vi.fn>

describe('UpgradeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    openExternal = vi.fn()
    ;(window as unknown as { electronShell: { openExternal: ReturnType<typeof vi.fn> } }).electronShell = { openExternal }
  })

  it('muestra los tres planes y ninguno mas', () => {
    render(<UpgradeModal onClose={() => {}} currentPlan="free" />)
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText('Cloud')).toBeInTheDocument()
    expect(screen.getByText('Teams')).toBeInTheDocument()
    expect(screen.queryByText('Pro')).not.toBeInTheDocument()
  })

  it('Teams no muestra precio: es venta asistida', () => {
    render(<UpgradeModal onClose={() => {}} currentPlan="free" />)
    expect(screen.getByRole('button', { name: /book a demo/i })).toBeInTheDocument()
    expect(screen.queryByText('$35')).toBeNull()
  })

  it('marca el plan actual en Free', () => {
    render(<UpgradeModal onClose={() => {}} currentPlan="free" />)
    expect(screen.getByText('Current plan')).toBeInTheDocument()
  })

  it('el toggle arranca en Monthly ($10 /mo) y Annual muestra $8 /mo billed $96 yearly', () => {
    render(<UpgradeModal onClose={() => {}} currentPlan="free" />)
    expect(screen.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('$10')).toBeInTheDocument()
    expect(screen.queryByText('billed $96 yearly')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Annual' }))
    expect(screen.getByRole('button', { name: 'Annual' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('$8')).toBeInTheDocument()
    expect(screen.getByText('billed $96 yearly')).toBeInTheDocument()
  })

  it('Upgrade to Cloud cobra el intervalo elegido, abre la URL y cierra', async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: { url: 'https://checkout.stripe.test/s' }, error: null })
    const onClose = vi.fn()
    render(<UpgradeModal onClose={onClose} currentPlan="free" />)
    fireEvent.click(screen.getByRole('button', { name: 'Annual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Cloud' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith('stripe-checkout', { body: { interval: 'annual' } })
    expect(openExternal).toHaveBeenCalledWith('https://checkout.stripe.test/s')
  })

  it('con plan cloud (o pro) el CTA es Manage subscription y abre el portal', async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: { url: 'https://billing.stripe.test/p' }, error: null })
    for (const plan of ['cloud', 'pro'] as const) {
      supabaseMock.functions.invoke.mockClear()
      const { unmount } = render(<UpgradeModal onClose={() => {}} currentPlan={plan} />)
      expect(screen.queryByRole('button', { name: 'Upgrade to Cloud' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Manage subscription' }))
      await waitFor(() => expect(supabaseMock.functions.invoke).toHaveBeenCalledWith('stripe-portal', { body: {} }))
      unmount()
    }
  })

  it('already_subscribed abre el portal en vez de fallar', async () => {
    supabaseMock.functions.invoke
      .mockResolvedValueOnce({ data: null, error: { context: { json: async () => ({ error: 'already_subscribed' }) } } })
      .mockResolvedValueOnce({ data: { url: 'https://billing.stripe.test/p' }, error: null })
    render(<UpgradeModal onClose={() => {}} currentPlan="free" />)
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Cloud' }))
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith('https://billing.stripe.test/p'))
  })

  it('un error se ve en el modal y el botón vuelve a habilitarse', async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'checkout_unavailable' }) } } })
    render(<UpgradeModal onClose={() => {}} currentPlan="free" />)
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Cloud' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Checkout isn't available right now — try again later.")
    expect(screen.getByRole('button', { name: 'Upgrade to Cloud' })).toBeEnabled()
  })

  it('mientras carga no se puede volver a pedir (doble click)', async () => {
    let resolver!: (v: unknown) => void
    supabaseMock.functions.invoke.mockImplementation(() => new Promise((r) => { resolver = r }))
    render(<UpgradeModal onClose={() => {}} currentPlan="free" />)
    const boton = screen.getByRole('button', { name: 'Upgrade to Cloud' })
    fireEvent.click(boton)
    expect(boton).toBeDisabled()
    fireEvent.click(boton)
    expect(supabaseMock.functions.invoke).toHaveBeenCalledTimes(1)
    resolver({ data: { url: 'https://checkout.stripe.test/s' }, error: null })
    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1))
  })
})
