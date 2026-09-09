// Spec §4 (D6 de las respuestas de Bauti). El endpoint POST /v1/projects/share existe desde
// Layer 1 y nunca tuvo UI: sin esto, un equipo que paga por memoria compartida no comparte
// nada y no tiene forma de notarlo.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ShareProjectCard from '../../components/ShareProjectCard'

// El mock lee una variable mutable para poder probar tambien el caso "sin equipos":
// vi.mock se hoistea, asi que la lista no puede ser un valor fijo por test.
const state = {
  teams: [
    { id: 't1', name: 'Nest', owner_id: 'u1', created_at: '' },
    { id: 't2', name: 'STI-PROJECTS', owner_id: 'u1', created_at: '' },
  ],
}

vi.mock('../../hooks/useTeam', () => ({
  useTeam: () => ({ teams: state.teams }),
}))

const setMemoryApi = (api: unknown): void => {
  ;(window as unknown as { memory?: unknown }).memory = api
}

const api = (over: Record<string, unknown> = {}) => ({
  teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: true, projectKey: 'abc123' }),
  shareProjectWithTeam: vi.fn().mockResolvedValue({ ok: true }),
  ...over,
})

beforeEach(() => {
  state.teams = [
    { id: 't1', name: 'Nest', owner_id: 'u1', created_at: '' },
    { id: 't2', name: 'STI-PROJECTS', owner_id: 'u1', created_at: '' },
  ]
})

afterEach(() => { setMemoryApi(undefined) })

describe('ShareProjectCard', () => {
  it('sin repo abierto no se muestra: no hay proyecto que compartir', () => {
    setMemoryApi(api())
    const { container } = render(<ShareProjectCard activeRepoPath={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lista los equipos del usuario como destino', async () => {
    setMemoryApi(api())
    render(<ShareProjectCard activeRepoPath="/repo" />)

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument())
    expect(screen.getByRole('option', { name: 'Nest' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'STI-PROJECTS' })).toBeInTheDocument()
  })

  it('comparte con el equipo elegido, no con el primero de la lista', async () => {
    const memoryApi = api()
    setMemoryApi(memoryApi)
    render(<ShareProjectCard activeRepoPath="/repo" />)

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument())
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't2' } })
    fireEvent.click(screen.getByRole('button', { name: /share/i }))

    await waitFor(() => {
      expect(memoryApi.shareProjectWithTeam).toHaveBeenCalledWith('abc123', 't2')
    })
    expect(await screen.findByText(/Shared with STI-PROJECTS/)).toBeInTheDocument()
  })

  it('un fallo del servidor se muestra, no se traga', async () => {
    setMemoryApi(api({
      shareProjectWithTeam: vi.fn().mockResolvedValue({ ok: false, error: 'plan_required' }),
    }))
    render(<ShareProjectCard activeRepoPath="/repo" />)

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /share/i }))

    expect(await screen.findByText(/plan_required/)).toBeInTheDocument()
  })

  it('sin equipos explica por que, en vez de dejar un selector vacio', async () => {
    state.teams = []
    setMemoryApi(api())
    render(<ShareProjectCard activeRepoPath="/repo" />)

    expect(await screen.findByText(/not in a team yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
