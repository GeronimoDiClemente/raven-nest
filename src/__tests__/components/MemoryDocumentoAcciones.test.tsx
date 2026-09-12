// Corregir y borrar una memoria desde la app.
//
// Hasta el 2026-09-12 esta pantalla sólo sabía GUARDAR. Una memoria mal escrita se quedaba
// mal para siempre — aunque un agente sí pudiera corregirla por `memory_update` del MCP — y
// no había forma de sacar algo que escribiste y no querías que existiera. Para memoria
// personal eso último no es una falta de comodidad.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MemoryGraphPanel from '../../components/MemoryGraphPanel'

const DETALLE = {
  syncId: 'obs-1',
  title: 'El deploy va por release.yml',
  content: 'Y nunca por build.yml.',
  type: 'decision',
  projectKey: 'raven-nest',
  gitBranch: 'main',
  tags: ['deploy'],
  updatedAt: Date.now(),
  originAi: null,
  supersededBy: null as string | null,
}

// El panel no monta con el grafo vacio (`graph.nodes.length === 0` devuelve null), asi que
// el doble tiene que traer al menos el nodo de la memoria que se esta mirando.
const NODO = {
  syncId: 'obs-1', projectKey: 'raven-nest', projectDisplayName: 'Raven Nest',
  tags: ['deploy'], title: 'El deploy va por release.yml', type: 'decision',
  scope: 'personal', topicKey: null, gitBranch: 'main', originAi: null,
  authorDisplay: null, updatedAt: Date.now(), superseded: false,
}

function montar(overrides: Record<string, unknown> = {}, detalle = DETALLE) {
  const api = {
    graph: vi.fn(async () => ({ nodes: [NODO], edges: [], truncated: 0 })),
    observation: vi.fn(async () => detalle),
    updateFromUi: vi.fn(async () => ({ ok: true })),
    deleteFromUi: vi.fn(async () => ({ ok: true })),
    ...overrides,
  }
  ;(window as unknown as { memory: unknown }).memory = api
  return api
}

beforeEach(() => { (window as unknown as { memory?: unknown }).memory = undefined })

async function abrirDetalle(props: Record<string, unknown> = {}) {
  render(<MemoryGraphPanel selectedId="obs-1" onSelect={vi.fn()} {...props} />)
  return screen.findByText('El deploy va por release.yml')
}

describe('el documento de una memoria — corregir', () => {
  it('ofrece editarla', async () => {
    montar()
    await abrirDetalle()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('al editar precarga el título y el cuerpo que ya tenía', async () => {
    montar()
    await abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Memory title')).toHaveValue('El deploy va por release.yml')
    expect(screen.getByLabelText('Memory content')).toHaveValue('Y nunca por build.yml.')
  })

  it('guarda los cambios y avisa para que la lista y el grafo se redibujen', async () => {
    const api = montar()
    const onCambiada = vi.fn()
    await abrirDetalle({ onCambiada })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Memory title'), { target: { value: 'Corregido' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateFromUi).toHaveBeenCalledWith(
      expect.objectContaining({ syncId: 'obs-1', title: 'Corregido' })
    ))
    await waitFor(() => expect(onCambiada).toHaveBeenCalled())
  })

  it('no deja guardar sin título — una memoria sin título no se encuentra después', async () => {
    montar()
    await abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Memory title'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  // `superseded` no es un error del usuario: es que otra máquina ya la reemplazó. Decirlo
  // con esas palabras importa, porque "no se pudo guardar" suena a que hizo algo mal.
  it('una memoria ya reemplazada no se puede editar, y lo explica', async () => {
    montar({}, { ...DETALLE, supersededBy: 'obs-2' })
    await abrirDetalle()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('con un preload viejo lo dice en vez de fallar en silencio', async () => {
    montar({ updateFromUi: undefined })
    await abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/cannot edit memories/i)).toBeInTheDocument()
  })
})

describe('el documento de una memoria — borrar', () => {
  // Pide confirmación y dice lo que de verdad va a pasar: el borrado CRUZA a las otras
  // máquinas, y eso no es obvio mirando una pantalla sola.
  it('pide confirmación y avisa que también desaparece de las otras máquinas', async () => {
    montar()
    await abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText(/other machines/i)).toBeInTheDocument()
  })

  it('cancelar no borra nada', async () => {
    const api = montar()
    await abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.deleteFromUi).not.toHaveBeenCalled()
  })

  it('al confirmar borra y deselecciona — ya no hay nada que mostrar', async () => {
    const api = montar()
    const onSelect = vi.fn()
    const onCambiada = vi.fn()
    render(<MemoryGraphPanel selectedId="obs-1" onSelect={onSelect} onCambiada={onCambiada} />)
    await screen.findByText('El deploy va por release.yml')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    // El de adentro del cuadro de confirmación, no el que lo abrió.
    const botones = screen.getAllByRole('button', { name: 'Delete' })
    fireEvent.click(botones[botones.length - 1])
    await waitFor(() => expect(api.deleteFromUi).toHaveBeenCalledWith('obs-1'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null))
    expect(onCambiada).toHaveBeenCalled()
  })
})
