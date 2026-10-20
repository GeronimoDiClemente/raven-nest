import { forwardRef, useImperativeHandle } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'

// El canvas no corre en jsdom: un boton por nodo alcanza.
vi.mock('react-force-graph-2d', () => ({
  default: forwardRef(function FG({ graphData }: { graphData: { nodes: Array<{ id: string; label: string }> } }, ref) {
    useImperativeHandle(ref, () => ({ d3Force: () => ({ distance: () => {} }), d3ReheatSimulation: () => {} }))
    return <div>{graphData.nodes.map((n) => <button key={n.id} type="button" aria-label={`node ${n.label}`} />)}</div>
  }),
}))

import MemoriesWorkspace from '../../components/MemoriesWorkspace'
import { __reiniciarPestanas } from '../../hooks/useMemoryTabs'

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
  let vecesQuePidioElGrafo = 0
  let vecesQuePidioLaMemoria = 0
  let enLaBase: Array<Record<string, unknown>> = []

  beforeEach(() => {
    __reiniciarPestanas()
    avisar = null
    bajas = 0
    vecesQuePidioElGrafo = 0
    vecesQuePidioLaMemoria = 0
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
      crossProject: async () => ({ items: [], nextCursor: null }),
      // El explorer y la pestaña Graph salen del grafo: es lo que se tiene que volver a pedir.
      graph: async () => {
        vecesQuePidioElGrafo += 1
        return { nodes: [...enLaBase], edges: [], truncated: 0 }
      },
      observation: async (syncId: string) => {
        vecesQuePidioLaMemoria += 1
        return {
          syncId, projectKey: 'p1', scope: 'project', type: 'decision', title: 'Abierta',
          content: '', tags: [], topicKey: null, gitBranch: null, originAi: null, authorDisplay: null,
          createdAt: 1, updatedAt: 1, supersededBy: null, revisionCount: 1, links: [], mentionedIn: [],
        }
      },
      encryptionStatus: async () => ({ ok: false, error: 'sin nube' }),
      onStatus: () => {},
      removeStatusListener: () => {},
    }
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('se suscribe al montar y pide de nuevo cuando llega el aviso', async () => {
    render(<MemoriesWorkspace onClose={() => {}} activeRepoPath={null} onOpenFile={() => {}} onHowItWorks={() => {}} onMemorySettingsTour={() => {}} />)
    await waitFor(() => expect(avisar).not.toBeNull())
    await waitFor(() => expect(vecesQuePidioElGrafo).toBeGreaterThan(0))
    const antes = vecesQuePidioElGrafo

    // Un agente guarda una memoria desde la terminal.
    avisar!()

    await waitFor(() => expect(vecesQuePidioElGrafo).toBeGreaterThan(antes))
  })

  // Contar pedidos no alcanza: lo que importa es que se VEA.
  it('la memoria que llega con el aviso aparece en el explorer', async () => {
    render(<MemoriesWorkspace onClose={() => {}} activeRepoPath={null} onOpenFile={() => {}} onHowItWorks={() => {}} onMemorySettingsTour={() => {}} />)
    await waitFor(() => expect(screen.getAllByText('No memories yet').length).toBeGreaterThan(0))

    enLaBase = [{
      syncId: 'nueva', projectKey: 'p1', projectDisplayName: 'raven-nest',
      title: 'La escribió un agente', type: 'decision', scope: 'project', topicKey: null,
      gitBranch: null, originAi: 'claude', authorDisplay: null, updatedAt: Date.now(), tags: [],
      superseded: false,
    }]
    avisar!()

    const explorer = within(document.querySelector('[data-tour-id="memories-explorer"]') as HTMLElement)
    expect(await explorer.findByRole('button', { name: 'La escribió un agente' })).toBeInTheDocument()
  })

  it('con una memoria abierta en una pestaña, el aviso la vuelve a leer', async () => {
    enLaBase = [{
      syncId: 'abierta', projectKey: 'p1', projectDisplayName: 'raven-nest',
      title: 'Abierta', type: 'decision', scope: 'project', topicKey: null,
      gitBranch: null, originAi: null, authorDisplay: null, updatedAt: 1, tags: [],
      superseded: false,
    }]
    render(<MemoriesWorkspace onClose={() => {}} activeRepoPath={null} onOpenFile={() => {}} onHowItWorks={() => {}} onMemorySettingsTour={() => {}} />)
    const explorer = within(document.querySelector('[data-tour-id="memories-explorer"]') as HTMLElement)
    fireEvent.click(await explorer.findByRole('button', { name: 'Abierta' }))
    await waitFor(() => expect(vecesQuePidioLaMemoria).toBe(1))

    avisar!()

    await waitFor(() => expect(vecesQuePidioLaMemoria).toBe(2))
  })

  it('da de baja la suscripción al desmontar', async () => {
    const { unmount } = render(<MemoriesWorkspace onClose={() => {}} activeRepoPath={null} onOpenFile={() => {}} onHowItWorks={() => {}} onMemorySettingsTour={() => {}} />)
    await waitFor(() => expect(avisar).not.toBeNull())
    unmount()
    expect(bajas).toBe(1)
  })

  // Una versión vieja del preload no expone `onChanged`. La pantalla tiene que montar igual,
  // no romperse: es exactamente el caso de una app a medio actualizar.
  it('sin `onChanged` en el preload, la pantalla monta igual', async () => {
    const api = (window as unknown as { memory: Record<string, unknown> }).memory
    delete api.onChanged
    expect(() => render(<MemoriesWorkspace onClose={() => {}} activeRepoPath={null} onOpenFile={() => {}} onHowItWorks={() => {}} onMemorySettingsTour={() => {}} />)).not.toThrow()
    await waitFor(() => expect(screen.getByText('Memories')).toBeInTheDocument())
  })
})
