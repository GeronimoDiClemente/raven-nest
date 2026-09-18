import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import LinkDeviceCard from '../../components/LinkDeviceCard'

const getSession = vi.fn(async () => ({ data: { session: { access_token: 'jwt-de-prueba' } } }))
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: () => getSession() } } }))

function montar(extra: Record<string, unknown> = {}) {
  const api = { linkApprove: vi.fn(async () => ({ ok: true })), ...extra }
  ;(window as unknown as { memory: unknown }).memory = api
  render(<LinkDeviceCard />)
  return api
}

const escribir = (valor: string) => {
  fireEvent.change(screen.getByLabelText(/code/i), { target: { value: valor } })
}

beforeEach(() => {
  ;(window as unknown as { memory?: unknown }).memory = undefined
  getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-de-prueba' } } })
})

describe('LinkDeviceCard', () => {
  it('con un preload viejo no monta nada, en vez de romper', () => {
    ;(window as unknown as { memory: unknown }).memory = {}
    const { container } = render(<LinkDeviceCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('el botón está apagado hasta que el código está completo', () => {
    montar()
    const boton = screen.getByRole('button', { name: /approve/i })
    expect(boton).toBeDisabled()
    escribir('WXYZ12')
    expect(boton).toBeDisabled()
    escribir('WXYZ1234')
    expect(boton).toBeEnabled()
  })

  it('manda el código normalizado, no lo que se tipeó', () => {
    const api = montar()
    escribir('  wxyz 1234 ')
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    return waitFor(() => {
      expect(api.linkApprove).toHaveBeenCalledWith('jwt-de-prueba', 'WXYZ-1234')
    })
  })

  it('al aprobar dice que la OTRA máquina es la que sigue', async () => {
    // Es lo único que el usuario tiene que hacer después: volver a la terminal. Una tarjeta
    // que sólo dijera "listo" lo deja mirando esta pantalla.
    montar()
    escribir('WXYZ1234')
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    await screen.findByText(/other machine/i)
  })

  it('un código vencido se explica y dice qué hacer', async () => {
    montar({ linkApprove: vi.fn(async () => ({ ok: false, error: 'expired' })) })
    escribir('WXYZ1234')
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    await screen.findByText(/expired/i)
    await screen.findByText(/new one/i)
  })

  it('sin sesión no pide nada al servicio y lo dice', async () => {
    getSession.mockResolvedValue({ data: { session: null } } as never)
    const api = montar()
    escribir('WXYZ1234')
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    await screen.findByText(/sign in/i)
    expect(api.linkApprove).not.toHaveBeenCalled()
  })

  it('un símbolo raro se avisa mientras se tipea, sin llamar a nadie', () => {
    const api = montar()
    escribir('WXYZ-12/4')
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled()
    expect(api.linkApprove).not.toHaveBeenCalled()
  })
})
