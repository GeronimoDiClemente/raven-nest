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
  let enLaBase: Array<Record<string, unknown>> = []

  beforeEach(() => {
    avisar = null
    bajas = 0
    vecesQuePidioLaLista = 0
    enLaBase = []
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
        return { items: [...enLaBase], nextCursor: null }
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

  // Contar pedidos no alcanza: la lista remontada pide con su PROPIO hook y descarta el
  // resultado, porque lo que dibuja es la búsqueda del workspace. Así este archivo pasaba
  // mientras la memoria nueva no aparecía nunca. Lo que importa es que se VEA.
  it('la memoria que llega con el aviso aparece en la lista', async () => {
    // La lista está virtualizada y jsdom mide todo en 0: sin alto, no monta ninguna fila.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
    render(<MemoriesWorkspace onClose={() => {}} activeRepoPath={null} onOpenFile={() => {}} />)
    await waitFor(() => expect(screen.getByText('No memories yet')).toBeInTheDocument())

    enLaBase = [{
      syncId: 'nueva', projectKey: 'p1', projectDisplayName: 'raven-nest',
      title: 'La escribió un agente', type: 'decision', scope: 'project',
      originAi: 'claude', authorDisplay: null, updatedAt: Date.now(), tags: [],
    }]
    avisar!()

    await waitFor(() => expect(screen.getByText('La escribió un agente')).toBeInTheDocument())
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
