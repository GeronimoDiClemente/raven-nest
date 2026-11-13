import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ShareProjectCard from '../../components/ShareProjectCard'

const mockTeamConfig = vi.hoisted(() => ({
  teams: [{ id: 't1', name: 'RENEMED' }],
}))

vi.mock('../../hooks/useTeam', () => ({
  useTeam: () => ({ teams: mockTeamConfig.teams }),
}))

/**
 * Compartir memoria dejó de ser una acción de autoservicio (2026-09-13). La card tiene que
 * DECIRLO, no ofrecer un select y un botón que el servidor va a rechazar con 403.
 *
 * El motivo importa y por eso está en la copia — pero review final de rama, IMPORTANT #7a:
 * "lo compartido todavía no se puede cifrar" dejó de ser cierto el 2026-10-15
 * (TeamEncryptionCard, cifrado de equipo). El gate real SIEMPRE fue de plan (`teamScope` en
 * server/src/limits.ts, ningún plan de autoservicio lo tiene), no de capacidad técnica — la
 * copia ahora lo dice así.
 */
describe('la card de compartir', () => {
  const conStatus = (puedeCompartirMemoria: boolean | undefined) => {
    ;(window as unknown as { memory: unknown }).memory = {
      status: async () => ({
        connected: true, deviceId: 'd', itemCount: 0, pendingCount: 0,
        daemonStatus: 'idle' as const, puedeCompartirMemoria,
      }),
      teamThreadProjectKeyForWorktree: async () => ({ ok: true, projectKey: 'p1' }),
      shareProjectWithTeam: async () => ({ ok: true }),
    }
  }

  beforeEach(() => { vi.restoreAllMocks() })

  it('sin permiso dice qué plan hace falta y no ofrece compartir', async () => {
    conStatus(false)
    render(<ShareProjectCard activeRepoPath="/repos/x" />)
    await waitFor(() => expect(screen.getByText('Sharing with a team needs a Teams plan.')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^Share with/ })).toBeNull()
    expect(screen.queryByLabelText('Team')).toBeNull()
  })

  it('con permiso, el control real sigue estando', async () => {
    conStatus(true)
    render(<ShareProjectCard activeRepoPath="/repos/x" />)

    await waitFor(() => expect(screen.getByRole('button', { name: /^Share with/ })).toBeInTheDocument())
    expect(screen.queryByText('Sharing with a team needs a Teams plan.')).toBeNull()
  })

  /** Spec 2026-10-21 §5 (D10): mientras no se sabe, la fila no se muestra — ni el control ni
   *  el cartel. Antes se mostraba el control. */
  it('mientras no se sabe, no muestra nada', async () => {
    conStatus(undefined)
    const { container } = render(<ShareProjectCard activeRepoPath="/repos/x" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
  })

  it('sin repo abierto no se dibuja nada', () => {
    conStatus(false)
    const { container } = render(<ShareProjectCard activeRepoPath={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('el nombre del equipo en el botón está en un span con font-mono', async () => {
    conStatus(true)
    render(<ShareProjectCard activeRepoPath="/repos/x" />)

    await waitFor(() => expect(screen.getByRole('button', { name: /^Share with/ })).toBeInTheDocument())
    const button = screen.getByRole('button', { name: /^Share with/ })
    // Verificar que el nombre está en un span con font-mono
    const span = button.querySelector('span.font-mono')
    expect(span).toBeInTheDocument()
    expect(span!.textContent).toBe('RENEMED')
  })

  it('trunca nombres largos de equipo a 40 caracteres con ellipsis', async () => {
    const longName = 'a'.repeat(100)
    mockTeamConfig.teams = [{ id: 't1', name: longName }]
    conStatus(true)
    render(<ShareProjectCard activeRepoPath="/repos/x" />)

    await waitFor(() => expect(screen.getByRole('button', { name: /^Share with/ })).toBeInTheDocument())
    const button = screen.getByRole('button', { name: /^Share with/ })
    // Verificar que el nombre se truncó a 40 chars + ellipsis
    const span = button.querySelector('span.font-mono')
    expect(span).toBeInTheDocument()
    expect(span!.textContent).toBe('a'.repeat(40) + '…')
    expect(span!.textContent!.length).toBe(41)

    // Restaurar para otros tests
    mockTeamConfig.teams = [{ id: 't1', name: 'RENEMED' }]
  })
})
