// Task 4 del corte comercial: el modal pasa de cuatro tiers a tres. El disparador cambia
// de raíz — antes era "querés un cuarto pane", ahora es "querés que este segundo proyecto
// viva en la nube".
//
// Dos desvíos respecto del snippet del plan, los dos porque el componente real es así:
// `UpgradeModal` es un default export y no tiene prop `open` (se monta condicionalmente),
// y "Book a demo" es un <button> que abre el navegador por `electronShell.openExternal`,
// no un <a href> — un link de verdad navegaría la ventana de Electron.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const supabaseMock = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  functions: { invoke: vi.fn() },
}))
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

import UpgradeModal from '../../components/UpgradeModal'

describe('UpgradeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    ;(window as unknown as { electronShell: { openExternal: ReturnType<typeof vi.fn> } })
      .electronShell = { openExternal: vi.fn() }
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

  it('Cloud muestra el precio que dice la constante, no uno escrito a mano', () => {
    render(<UpgradeModal onClose={() => {}} currentPlan="free" />)

    expect(screen.getByText('$10')).toBeInTheDocument()
  })

  it('marca el plan actual', () => {
    render(<UpgradeModal onClose={() => {}} currentPlan="cloud" />)

    expect(screen.getByText('Current plan')).toBeInTheDocument()
  })
})
