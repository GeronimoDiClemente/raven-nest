// Spec 2026-09-11 §1: la lista, la busqueda, tipo/proyecto/agente/fecha por fila, y los
// tres estados de manejo de errores (vacio real, error de IPC, preload viejo sin la
// API). No prueba scroll infinito de verdad (jsdom no hace layout) — loadMore se prueba
// aparte, contra la funcion, en useCrossProjectMemories.test.tsx.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import MemoriesList from '../../components/MemoriesList'
import type { CrossProjectObservation } from '../../types'

const setMemoryApi = (api: unknown): void => {
  ;(window as unknown as { memory?: unknown }).memory = api
}

// @tanstack/react-virtual mide el contenedor de scroll (clientHeight) para decidir
// cuantas filas montar. jsdom no hace layout de verdad y devuelve 0 — sin esto la
// lista de virtual items sale vacia y ninguna fila se monta, aunque `items` no este
// vacio. Patron estandar para testear tanstack-virtual bajo jsdom.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
})

afterEach(() => {
  setMemoryApi(undefined)
  vi.restoreAllMocks()
})

const item = (over: Partial<CrossProjectObservation> = {}): CrossProjectObservation => ({
  syncId: 's1',
  projectKey: 'raven-nest',
  projectDisplayName: 'raven-nest',
  title: 'Decided to index crossProjectMemories() for the listing screen',
  type: 'decision',
  scope: 'project',
  originAi: 'claude',
  authorDisplay: null,
  updatedAt: Date.now(),
  tags: [],
  ...over,
})

describe('MemoriesList', () => {
  it('muestra titulo, proyecto y el logo del agente por fila', async () => {
    setMemoryApi({
      crossProject: vi.fn().mockResolvedValue({ items: [item()], nextCursor: null }),
    })
    render(<MemoriesList />)

    await waitFor(() => expect(screen.getByText(/Decided to index crossProjectMemories/)).toBeInTheDocument())
    expect(screen.getByText('raven-nest')).toBeInTheDocument()
    // AILogo(aiType: 'claude') renderiza un <svg> — no hay texto que buscar, se
    // confirma por la presencia del elemento dentro de la fila.
    const row = screen.getByText(/Decided to index crossProjectMemories/).closest('div')
    expect(row?.querySelector('svg')).toBeTruthy()
  })

  it('un originAi null no renderiza ningun logo (sin fallback generico)', async () => {
    setMemoryApi({
      crossProject: vi.fn().mockResolvedValue({
        items: [item({ originAi: null, title: 'Escrita a mano, sin agente' })],
        nextCursor: null,
      }),
    })
    render(<MemoriesList />)

    await waitFor(() => expect(screen.getByText('Escrita a mano, sin agente')).toBeInTheDocument())
    const row = screen.getByText('Escrita a mano, sin agente').closest('div')
    expect(row?.querySelector('svg')).toBeNull()
  })

  it('la busqueda pide de nuevo con la query, cursor reseteado', async () => {
    const crossProject = vi.fn()
      .mockResolvedValueOnce({ items: [item()], nextCursor: null })
      .mockResolvedValueOnce({ items: [item({ syncId: 's2', title: 'FTS5 result' })], nextCursor: null })
    setMemoryApi({ crossProject })

    render(<MemoriesList />)
    await waitFor(() => expect(crossProject).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByPlaceholderText('Search memories…'), { target: { value: 'fts5' } })

    await waitFor(() => expect(crossProject).toHaveBeenCalledTimes(2), { timeout: 1000 })
    expect(crossProject).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'fts5', cursor: null }))
  })

  it('lista vacia de verdad: dice que los agentes guardan solos, sin boton (spec: no hay accion honesta)', async () => {
    setMemoryApi({
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    })
    render(<MemoriesList />)

    await waitFor(() => expect(screen.getByText('No memories yet')).toBeInTheDocument())
    expect(screen.getByText(/agents save memories here on their own/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('un error de IPC se muestra, no se cae la pantalla ni queda una lista vacia mentirosa', async () => {
    setMemoryApi({
      crossProject: vi.fn().mockRejectedValue(new Error('memory subsystem down')),
    })
    render(<MemoriesList />)

    await waitFor(() => expect(screen.getByText("Couldn't load memories")).toBeInTheDocument())
    expect(screen.getByText(/memory subsystem down/)).toBeInTheDocument()
    expect(screen.queryByText('No memories yet')).not.toBeInTheDocument()
  })

  it('preload viejo sin crossProject: unavailable, no revienta el arbol', async () => {
    setMemoryApi({})
    render(<MemoriesList />)

    await waitFor(() => expect(screen.getByText('Memory list unavailable')).toBeInTheDocument())
  })

  it('la capacidad del MCP se dice en una linea, siempre visible', async () => {
    setMemoryApi({
      crossProject: vi.fn().mockResolvedValue({ items: [item()], nextCursor: null }),
    })
    render(<MemoriesList />)

    expect(screen.getByText(/read and save memories here on their own/)).toBeInTheDocument()
  })

  it('el tipo se distingue por color sin depender de leer texto (leyenda categorica)', async () => {
    setMemoryApi({
      crossProject: vi.fn().mockResolvedValue({ items: [item({ type: 'bugfix' })], nextCursor: null }),
    })
    render(<MemoriesList />)

    await waitFor(() => expect(screen.getByTitle('Bugfix')).toBeInTheDocument())
  })
})
