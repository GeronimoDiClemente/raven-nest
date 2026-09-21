// La tarjeta que dice con qué servicio de sync habla esta instalación, y deja cambiarlo.
//
// Existe porque el campo que lo permitía (`syncBaseUrl` en `connection.json`) estaba
// declarado desde el principio y no lo escribía NADIE: la única fuente real era una variable
// horneada en el build, que los workflows de release no pasan. Sin esta pantalla, arreglar
// una instalación que apunta a un servicio muerto exige recompilar la app.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import SyncServiceCard from '../../components/SyncServiceCard'

const POR_DEFECTO = 'https://sync-production-54ba.up.railway.app'

function montar(extra: Record<string, unknown> = {}) {
  const api = {
    syncService: vi.fn(async () => ({ url: POR_DEFECTO, elegida: null, porDefecto: POR_DEFECTO })),
    setSyncService: vi.fn(async (url: string | null) => ({
      ok: true as const,
      url: url ?? POR_DEFECTO,
      hayQueReconectar: false,
    })),
    ...extra,
  }
  ;(window as unknown as { memory: unknown }).memory = api
  render(<SyncServiceCard />)
  return api
}

const abrir = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /change/i }))
}
const escribir = (valor: string) => {
  fireEvent.change(screen.getByLabelText(/service address/i), { target: { value: valor } })
}
const guardar = () => fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

beforeEach(() => {
  ;(window as unknown as { memory?: unknown }).memory = undefined
})

describe('SyncServiceCard', () => {
  it('con un preload viejo no monta nada, en vez de romper', () => {
    ;(window as unknown as { memory: unknown }).memory = {}
    const { container } = render(<SyncServiceCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('muestra a qué servicio le habla hoy', async () => {
    montar()
    expect(await screen.findByText(POR_DEFECTO)).toBeInTheDocument()
  })

  // Es la diferencia entre "no configuraste nada y anda igual" y "vos elegiste esto". Sin
  // distinguirlas, alguien que ve la URL del default cree que la eligió y no la toca nunca.
  it('dice cuándo la dirección es la que viene con Nest y no una elegida', async () => {
    montar()
    expect(await screen.findByText(/comes with nest/i)).toBeInTheDocument()
  })

  it('cuando hay una elegida, lo dice en vez de hablar del default', async () => {
    montar({
      syncService: vi.fn(async () => ({
        url: 'https://mio.example.com',
        elegida: 'https://mio.example.com',
        porDefecto: POR_DEFECTO,
      })),
    })
    expect(await screen.findByText('https://mio.example.com')).toBeInTheDocument()
    expect(screen.queryByText(/comes with nest/i)).not.toBeInTheDocument()
  })

  it('el campo arranca escondido: cambiar de servicio no es algo que se haga todos los días', async () => {
    montar()
    await screen.findByText(POR_DEFECTO)
    expect(screen.queryByLabelText(/service address/i)).not.toBeInTheDocument()
    await abrir()
    expect(screen.getByLabelText(/service address/i)).toBeInTheDocument()
  })

  it('guarda lo tipeado y muestra la dirección que quedó', async () => {
    const api = montar({
      setSyncService: vi.fn(async () => ({ ok: true, url: 'https://otro.example.com', hayQueReconectar: false })),
    })
    await abrir()
    escribir('https://otro.example.com')
    guardar()
    await waitFor(() => expect(api.setSyncService).toHaveBeenCalledWith('https://otro.example.com'))
    expect(await screen.findByText('https://otro.example.com')).toBeInTheDocument()
  })

  // El main rechaza lo que no es una URL. Lo que se prueba acá es que el rechazo SE VEA: si
  // se tragara, la pantalla mostraría la dirección vieja y el usuario creería que cambió.
  it('un rechazo del main se muestra y la dirección no cambia', async () => {
    montar({
      setSyncService: vi.fn(async () => ({ ok: false, error: 'That is not a service address' })),
    })
    await abrir()
    escribir('no-es-una-url')
    guardar()
    expect(await screen.findByText(/not a service address/i)).toBeInTheDocument()
    expect(screen.getByText(POR_DEFECTO)).toBeInTheDocument()
  })

  it('vaciar el campo vuelve al default y lo manda como null', async () => {
    const api = montar({
      syncService: vi.fn(async () => ({ url: 'https://mio.example.com', elegida: 'https://mio.example.com', porDefecto: POR_DEFECTO })),
    })
    await abrir()
    escribir('')
    guardar()
    await waitFor(() => expect(api.setSyncService).toHaveBeenCalledWith(null))
  })

  // El token de device lo emitió el servicio viejo. Si el nuevo no lo conoce, el síntoma es
  // un 401 del daemon en algún momento posterior, y para entonces ya nadie ata el error con
  // este cambio.
  it('si la máquina estaba conectada, avisa que puede haber que conectarla de nuevo', async () => {
    montar({
      setSyncService: vi.fn(async () => ({ ok: true, url: 'https://otro.example.com', hayQueReconectar: true })),
    })
    await abrir()
    escribir('https://otro.example.com')
    guardar()
    expect(await screen.findByText(/connect this machine again/i)).toBeInTheDocument()
  })
})
