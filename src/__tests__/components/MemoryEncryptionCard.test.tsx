import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import MemoryEncryptionCard from '../../components/MemoryEncryptionCard'

// Tipado a mano: con el literal pelado, `pendingDevices: []` se infiere `never[]` y el
// caso que le pasa una maquina esperando no compila.
interface EstadoCifrado {
  available: boolean
  active: boolean
  keyEpoch: number
  pendingDevices: Array<{ deviceId: string; name: string }>
  undecryptable: number
}

const estadoBase: EstadoCifrado = {
  available: true, active: false, keyEpoch: 0, pendingDevices: [], undecryptable: 0,
}

function montarCon(estado: Partial<EstadoCifrado>, extra: Record<string, unknown> = {}) {
  const api = {
    encryptionStatus: vi.fn(async () => ({ ...estadoBase, ...estado })),
    encryptionActivate: vi.fn(async () => ({ ok: true, recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF' })),
    encryptionAuthorize: vi.fn(async () => ({ ok: true })),
    encryptionRecover: vi.fn(async () => ({ ok: true })),
    encryptionReencrypt: vi.fn(async () => ({ total: 866, queued: 0 })),
    ...extra,
  }
  ;(window as unknown as { memory: unknown }).memory = api
  return api
}

beforeEach(() => { (window as unknown as { memory?: unknown }).memory = undefined })

describe('MemoryEncryptionCard', () => {
  it('con un preload viejo no monta nada, en vez de romper', () => {
    ;(window as unknown as { memory: unknown }).memory = {}
    const { container } = render(<MemoryEncryptionCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('sin disponibilidad muestra el motivo y no ofrece activar', async () => {
    montarCon({ available: false })
    render(<MemoryEncryptionCard />)
    expect(await screen.findByText(/conectá la memoria en la nube/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /activar/i })).toBeNull()
  })

  it('sin activar ofrece activarlo y dice qué queda en claro', async () => {
    montarCon({})
    render(<MemoryEncryptionCard />)
    expect(await screen.findByRole('button', { name: /activar el cifrado/i })).toBeInTheDocument()
    // La promesa honesta del §5.2, en la tarjeta y no solo en la landing.
    expect(screen.getByText(/tipo, el scope y la rama/i)).toBeInTheDocument()
  })

  // El momento de la verdad: el codigo se muestra UNA vez y hay que obligar a copiarlo.
  it('al activar muestra el código de recuperación y no deja seguir sin confirmar', async () => {
    const api = montarCon({})
    render(<MemoryEncryptionCard />)
    fireEvent.click(await screen.findByRole('button', { name: /activar el cifrado/i }))
    await waitFor(() => expect(api.encryptionActivate).toHaveBeenCalled())
    expect(await screen.findByText('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF')).toBeInTheDocument()
    expect(screen.getByText(/no lo vas a volver a ver/i)).toBeInTheDocument()
    const seguir = screen.getByRole('button', { name: /ya lo guardé/i })
    expect(seguir).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(seguir).toBeEnabled()
  })

  it('activo muestra la época y ofrece re-subir lo viejo', async () => {
    const api = montarCon({ active: true, keyEpoch: 1 })
    render(<MemoryEncryptionCard />)
    expect(await screen.findByText(/cifrado activo/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /re-subir/i }))
    await waitFor(() => expect(api.encryptionReencrypt).toHaveBeenCalled())
    expect(await screen.findByText(/866/)).toBeInTheDocument()
  })

  it('con máquinas esperando, ofrece autorizarlas por nombre', async () => {
    const api = montarCon({ active: true, keyEpoch: 1, pendingDevices: [{ deviceId: 'pc', name: 'la PC' }] })
    render(<MemoryEncryptionCard />)
    fireEvent.click(await screen.findByRole('button', { name: /autorizar la PC/i }))
    await waitFor(() => expect(api.encryptionAuthorize).toHaveBeenCalledWith('pc'))
  })

  // Esta maquina no puede leer: es el estado que la spec §5.5.4 obliga a mostrar fuerte.
  it('con época pero sin clave local, pide autorización o el código', async () => {
    montarCon({ active: false, keyEpoch: 1, undecryptable: 12 })
    render(<MemoryEncryptionCard />)
    expect(await screen.findByText(/esta máquina todavía no está autorizada/i)).toBeInTheDocument()
    expect(screen.getByText(/12/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /usar el código de recuperación/i })).toBeInTheDocument()
  })

  it('recuperar con un código equivocado muestra el error y no cierra el formulario', async () => {
    montarCon({ active: false, keyEpoch: 1 }, {
      encryptionRecover: vi.fn(async () => ({ ok: false, error: 'código de recuperación incorrecto' })),
    })
    render(<MemoryEncryptionCard />)
    fireEvent.click(await screen.findByRole('button', { name: /usar el código de recuperación/i }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'XXXX' } })
    fireEvent.click(screen.getByRole('button', { name: /recuperar/i }))
    expect(await screen.findByText(/incorrecto/i)).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })
})
