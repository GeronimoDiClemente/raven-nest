import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import MemoriesWorkspace from '../../components/MemoriesWorkspace'

/**
 * La memoria que escribe un AGENTE tiene que aparecer sin que toques nada.
 *
 * Es la mitad interesante del producto —que lo escriban ellos mientras trabajás— y la
 * pantalla no se enteraba: sólo se refrescaba por acciones tuyas (guardar a mano, borrar,
 * conectar dos), así que una memoria escrita desde la terminal no aparecía hasta cerrar y
 * reabrir el overlay.
 */
describe('la pantalla se entera de lo que escriben los agentes', () => {
  let avisar: (() => void) | null = null
  let bajas = 0
  let vecesQuePidioLaLista = 0

  beforeEach(() => {
    avisar = null
    bajas = 0
    vecesQuePidioLaLista = 0
    ;(window as unknown as { memory: unknown }).memory = {
      onChanged: (cb: () => void) => {
        avisar = cb
        return () => { bajas += 1 }
      },
      status: async () => ({
        connected: false, deviceId: null, itemCount: 0, pendingCount: 0,
        daemonStatus: 'idle' as const,
      }),
      crossProject: async () => {
        vecesQuePidioLaLista += 1
        return { items: [], nextCursor: null }
      },
      graph: async () => ({ nodes: [], edges: [], truncated: false }),
      encryptionStatus: async () => ({ ok: false, error: 'sin nube' }),
      onStatus: () => {},
      removeStatusListener: () => {},
    }
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('se suscribe al montar y pide de nuevo cuando llega el aviso', async () => {
    render(<MemoriesWorkspace onClose={() => {}} activeRepoPath={null} onOpenFile={() => {}} />)
    await waitFor(() => expect(avisar).not.toBeNull())
    const antes = vecesQuePidioLaLista

    // Un agente guarda una memoria desde la terminal.
    avisar!()

    await waitFor(() => expect(vecesQuePidioLaLista).toBeGreaterThan(antes))
  })

  it('da de baja la suscripción al desmontar', async () => {
    const { unmount } = render(<MemoriesWorkspace onClose={() => {}} activeRepoPath={null} onOpenFile={() => {}} />)
    await waitFor(() => expect(avisar).not.toBeNull())
    unmount()
    expect(bajas).toBe(1)
  })

  // Una versión vieja del preload no expone `onChanged`. La pantalla tiene que montar igual,
  // no romperse: es exactamente el caso de una app a medio actualizar.
  it('sin `onChanged` en el preload, la pantalla monta igual', async () => {
    const api = (window as unknown as { memory: Record<string, unknown> }).memory
    delete api.onChanged
    expect(() => render(<MemoriesWorkspace onClose={() => {}} activeRepoPath={null} onOpenFile={() => {}} />)).not.toThrow()
    await waitFor(() => expect(screen.getByText('Memories')).toBeInTheDocument())
  })
})
