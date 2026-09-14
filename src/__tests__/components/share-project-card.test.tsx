import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ShareProjectCard from '../../components/ShareProjectCard'

vi.mock('../../hooks/useTeam', () => ({
  useTeam: () => ({ teams: [{ id: 't1', name: 'RENEMED' }] }),
}))

/**
 * Compartir memoria dejó de ser una acción de autoservicio (2026-09-13). La card tiene que
 * DECIRLO, no ofrecer un select y un botón que el servidor va a rechazar con 403.
 *
 * El motivo importa y por eso está en la copia: "necesitás otro plan" invita a buscar dónde
 * pagar; la razón real es que lo compartido todavía no se puede cifrar, y eso hace que la
 * respuesta tenga sentido en vez de parecer un paywall.
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

  it('sin permiso explica el motivo y no ofrece compartir', async () => {
    conStatus(false)
    render(<ShareProjectCard activeRepoPath="/repos/x" />)

    await waitFor(() => expect(screen.getByText(/not end-to-end encrypted yet/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^Share$/ })).toBeNull()
    expect(screen.queryByLabelText('Team')).toBeNull()
  })

  it('con permiso, el control real sigue estando', async () => {
    conStatus(true)
    render(<ShareProjectCard activeRepoPath="/repos/x" />)

    await waitFor(() => expect(screen.getByRole('button', { name: /^Share$/ })).toBeInTheDocument())
    expect(screen.queryByText(/not end-to-end encrypted yet/i)).toBeNull()
  })

  /**
   * `undefined` = todavía no llegó una respuesta de status. No saber NO es lo mismo que saber
   * que no: negarle la acción a alguien porque la app arrancó hace tres segundos sería peor
   * que dejar que el servidor la rechace.
   */
  it('mientras no se sabe, no muestra el cartel de "no podés"', async () => {
    conStatus(undefined)
    render(<ShareProjectCard activeRepoPath="/repos/x" />)

    await waitFor(() => expect(screen.getByRole('button', { name: /^Share$/ })).toBeInTheDocument())
    expect(screen.queryByText(/not end-to-end encrypted yet/i)).toBeNull()
  })

  it('sin repo abierto no se dibuja nada', () => {
    conStatus(false)
    const { container } = render(<ShareProjectCard activeRepoPath={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
