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

    // El Select de Radix porta las opciones al DOM recien al abrirse.
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('combobox'))
    expect(await screen.findByRole('option', { name: 'Nest' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'STI-PROJECTS' })).toBeInTheDocument()
  })

  it('comparte con el equipo elegido, no con el primero de la lista', async () => {
    const memoryApi = api()
    setMemoryApi(memoryApi)
    render(<ShareProjectCard activeRepoPath="/repo" />)

    // El Select de Radix no es un <select> nativo: no hay `target.value` que asignar.
    // Se abre el popup clickeando el trigger (role="combobox") y se elige clickeando
    // el option — ver el polyfill de scrollIntoView/pointerCapture en setup-dom.ts,
    // sin el cual esto revienta en jsdom.
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'STI-PROJECTS' }))
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

  // Review final de rama, IMPORTANT #7b: compartir el proyecto NO mueve ninguna fila por si
  // solo — solo vuelve legal que el proyecto lleve `scope: 'team'`, y la UNICA forma de que
  // una memoria llegue a esa escala es `promoteToTeam()` (electron/memory-store.ts), que no
  // corre sola. El texto viejo decia "incluyendo las ya guardadas", que es justo lo que no
  // pasa.
  it('"The team will see" no promete memorias ya guardadas ni automaticas', async () => {
    setMemoryApi(api())
    render(<ShareProjectCard activeRepoPath="/repo" />)

    await waitFor(() => expect(screen.getByText('The team will see')).toBeInTheDocument())
    expect(screen.getByText(/Only memories someone promotes to the team/)).toBeInTheDocument()
    expect(screen.queryByText(/including the ones already saved/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Everything already saved here/)).toBeInTheDocument()
  })

  // Review final de rama, IMPORTANT #7a: el plan "no se puede compartir" decia que la
  // memoria de equipo "no esta cifrada de punta a punta todavia" — falso desde el
  // 2026-10-15 (TeamEncryptionCard). El gate real es de plan (`teamScope` en
  // server/src/limits.ts), no de capacidad tecnica.
  it('sin permiso de compartir, explica el gate de plan y no habla de falta de cifrado', async () => {
    setMemoryApi(api({ status: vi.fn().mockResolvedValue({ puedeCompartirMemoria: false }) }))
    render(<ShareProjectCard activeRepoPath="/repo" />)

    await waitFor(() => expect(screen.getByText(/isn't part of a self-serve plan/)).toBeInTheDocument())
    expect(screen.queryByText(/not end-to-end encrypted yet/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/there is no key two people share/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Memory settings → Encryption/)).toBeInTheDocument()
  })
})
