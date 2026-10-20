// Task 10 (Memories estilo Obsidian): el workspace nuevo — explorer a la izquierda, pestañas
// en el centro (Graph fija, una por nota, New memory, Team thread) y el panel derecho.
import { forwardRef, useImperativeHandle } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { MemoryGraphNode, MemoryObservationDetail } from '../../types'

// El canvas de react-force-graph-2d no corre en jsdom: un boton por nodo alcanza para ver que
// llega al grafo y para hacer click. `aria-label` con prefijo, para no chocar con los botones
// del explorer que tienen el titulo pelado.
vi.mock('react-force-graph-2d', () => ({
  default: forwardRef(function FG(
    { graphData, onNodeClick }: { graphData: { nodes: Array<{ id: string; label: string }> }; onNodeClick: (n: { id: string }, e: MouseEvent) => void },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ d3Force: () => ({ distance: () => {} }), d3ReheatSimulation: () => {} }))
    return (
      <div data-testid="fg2d">
        {graphData.nodes.map((n) => (
          <button key={n.id} type="button" aria-label={`node ${n.label}`} onClick={(e) => onNodeClick(n, e.nativeEvent)} />
        ))}
      </div>
    )
  }),
}))

import MemoriesWorkspace from '../../components/MemoriesWorkspace'
import { __reiniciarPestanas } from '../../hooks/useMemoryTabs'

const setMemoryApi = (api: unknown): void => {
  ;(window as unknown as { memory?: unknown }).memory = api
}

const api = (over: Record<string, unknown> = {}) => ({
  status: vi.fn().mockResolvedValue({
    connected: true, deviceId: 'd1', itemCount: 142, pendingCount: 0, daemonStatus: 'idle',
  }),
  sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [], silentCount: 0 }),
  doctor: vi.fn().mockResolvedValue({ ok: true, blockedTotal: 0, groups: [] }),
  vaultHealth: vi.fn().mockResolvedValue({
    ok: true, enabled: true, rootDir: '/vault', noteCount: 866, conflictCount: 0,
    lastGeneratedAt: Date.now() - 90 * 60_000,
  }),
  vaultGetSettings: vi.fn().mockResolvedValue({ ok: false, error: 'memory_unavailable' }),
  teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: false }),
  hubStats: vi.fn().mockResolvedValue({ itemCount: 0, projectCount: 0 }),
  ...over,
})

const nodo = (syncId: string, title: string, type = 'decision'): MemoryGraphNode => ({
  syncId, projectKey: 'p1', projectDisplayName: 'raven-nest', tags: [], title, type,
  scope: 'project', topicKey: null, gitBranch: 'main', originAi: null, authorDisplay: null,
  updatedAt: 1, superseded: false,
})

const TITULOS: Record<string, string> = { a: 'Auth pasa a cookies', b: 'Otra', n1: 'Nueva a mano' }

const detalle = (syncId: string, o: Partial<MemoryObservationDetail> = {}): MemoryObservationDetail => ({
  syncId, projectKey: 'p1', scope: 'project', type: 'decision', title: TITULOS[syncId] ?? syncId,
  content: 'Cuerpo', tags: [], topicKey: null, gitBranch: 'main', originAi: null, authorDisplay: null,
  createdAt: 1, updatedAt: 1, supersededBy: null, revisionCount: 1, links: [], mentionedIn: [], ...o,
})

const grafoAB = () => ({
  truncated: 0,
  nodes: [nodo('a', 'Auth pasa a cookies'), nodo('b', 'Otra')],
  edges: [{ from: 'a', to: 'b', kind: 'wikilink', directed: true }],
})

const props = (over: Partial<{ activeRepoPath: string | null }> = {}) => ({
  onClose: () => {},
  activeRepoPath: over.activeRepoPath ?? null,
  onOpenFile: () => {},
  onHowItWorks: () => {},
  onMemorySettingsTour: () => {},
})

const explorer = () => within(document.querySelector('[data-tour-id="memories-explorer"]') as HTMLElement)
const panelDerecho = () => within(screen.getByRole('complementary', { name: 'Side panel' }))
const raiz = () => document.querySelector('.memories-workspace') as HTMLElement

async function abrirA() {
  fireEvent.click(await explorer().findByRole('button', { name: 'Auth pasa a cookies' }))
  expect(await screen.findByRole('tab', { name: /Auth pasa a cookies/, selected: true })).toBeInTheDocument()
  await screen.findByRole('textbox', { name: 'Memory title' })
}

async function empezarAConectar() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Connect to another memory…' }))
  expect(await screen.findByText(/Pick the memory this one goes with/)).toBeInTheDocument()
}

beforeEach(() => {
  __reiniciarPestanas()
  localStorage.clear()
})
afterEach(() => {
  setMemoryApi(undefined)
  delete (window as unknown as { git?: unknown }).git
  vi.restoreAllMocks()
})

describe('MemoriesWorkspace estilo Obsidian', () => {
  it('arranca en Graph; abrir desde el explorer crea una pestana con la nota y su panel', async () => {
    setMemoryApi(api({
      graph: vi.fn().mockResolvedValue(grafoAB()),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      observation: vi.fn().mockImplementation(async (id: string) => detalle(id)),
    }))
    render(<MemoriesWorkspace {...props()} />)
    expect(await screen.findByRole('tab', { name: /Graph/, selected: true })).toBeInTheDocument()
    // El grafo global recibe los nodos.
    expect(await screen.findByRole('button', { name: 'node Auth pasa a cookies' })).toBeInTheDocument()

    fireEvent.click(await explorer().findByRole('button', { name: 'Auth pasa a cookies' }))
    expect(await screen.findByRole('tab', { name: /Auth pasa a cookies/, selected: true })).toBeInTheDocument()
    expect(await screen.findByRole('textbox', { name: 'Memory title' })).toHaveValue('Auth pasa a cookies')
    expect(panelDerecho().getByText('Mentioned in')).toBeInTheDocument()
  })

  it('click en un nodo del grafo abre la memoria', async () => {
    setMemoryApi(api({
      graph: vi.fn().mockResolvedValue(grafoAB()),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      observation: vi.fn().mockImplementation(async (id: string) => detalle(id)),
    }))
    render(<MemoriesWorkspace {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'node Otra' }))
    expect(await screen.findByRole('tab', { name: /Otra/, selected: true })).toBeInTheDocument()
  })

  it('conectar a mano: el menu pone el modo y el proximo click enlaza en vez de abrir; Esc cancela', async () => {
    const link = vi.fn().mockResolvedValue({ ok: true })
    const graph = vi.fn().mockResolvedValue(grafoAB())
    setMemoryApi(api({
      graph,
      link,
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      observation: vi.fn().mockImplementation(async (id: string) => detalle(id)),
    }))
    render(<MemoriesWorkspace {...props()} />)
    await abrirA()

    await empezarAConectar()
    const pedidosDelGrafo = graph.mock.calls.length
    fireEvent.click(explorer().getByRole('button', { name: 'Otra' }))
    await waitFor(() => expect(link).toHaveBeenCalledWith('a', 'b'))
    await waitFor(() => expect(screen.queryByText(/Pick the memory this one goes with/)).toBeNull())
    expect(screen.queryByRole('tab', { name: /Otra/ })).toBeNull()
    // El enlace nuevo se tiene que ver: el grafo se vuelve a pedir.
    await waitFor(() => expect(graph.mock.calls.length).toBeGreaterThan(pedidosDelGrafo))

    await empezarAConectar()
    fireEvent.keyDown(raiz(), { key: 'Escape' })
    expect(screen.queryByText(/Pick the memory this one goes with/)).toBeNull()
    fireEvent.click(explorer().getByRole('button', { name: 'Otra' }))
    expect(link).toHaveBeenCalledTimes(1)
    // Sin el modo, el click abre.
    expect(await screen.findByRole('tab', { name: /Otra/, selected: true })).toBeInTheDocument()
  })

  it('conectar a mano: un fallo de link lo dice con el mensaje de siempre', async () => {
    setMemoryApi(api({
      graph: vi.fn().mockResolvedValue(grafoAB()),
      link: vi.fn().mockResolvedValue({ ok: false, error: 'memory_not_found' }),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      observation: vi.fn().mockImplementation(async (id: string) => detalle(id)),
    }))
    render(<MemoriesWorkspace {...props()} />)
    await abrirA()
    await empezarAConectar()
    fireEvent.click(explorer().getByRole('button', { name: 'Otra' }))
    expect(await screen.findByText('One of those memories is no longer there.')).toBeInTheDocument()
  })

  it('Ctrl+W cierra la pestana activa y no burbujea (Review Focus 1)', async () => {
    setMemoryApi(api({
      graph: vi.fn().mockResolvedValue(grafoAB()),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      observation: vi.fn().mockImplementation(async (id: string) => detalle(id)),
    }))
    render(<MemoriesWorkspace {...props()} />)
    await abrirA()

    const enWindow = vi.fn()
    window.addEventListener('keydown', enWindow)
    try {
      const ev = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true })
      fireEvent(screen.getByRole('textbox', { name: 'Memory title' }), ev)
      await waitFor(() => expect(screen.queryByRole('tab', { name: /Auth pasa a cookies/ })).toBeNull())
      expect(ev.defaultPrevented).toBe(true)
      expect(enWindow).not.toHaveBeenCalled()
      // La activa pasa a la de la izquierda: Graph.
      expect(screen.getByRole('tab', { name: /Graph/, selected: true })).toBeInTheDocument()

      // En Graph (fija) no cierra nada, pero tampoco deja pasar el atajo a la ventana.
      const ev2 = new KeyboardEvent('keydown', { key: 'w', metaKey: true, bubbles: true, cancelable: true })
      fireEvent(raiz(), ev2)
      expect(ev2.defaultPrevented).toBe(true)
      expect(enWindow).not.toHaveBeenCalled()
      expect(screen.getByRole('tab', { name: /Graph/, selected: true })).toBeInTheDocument()
    } finally {
      window.removeEventListener('keydown', enWindow)
    }
  })

  it('New memory abre una pestana con el formulario y al guardar pasa a la memoria nueva', async () => {
    const saveFromUi = vi.fn().mockResolvedValue({ ok: true, syncId: 'n1' })
    setMemoryApi(api({
      graph: vi.fn().mockResolvedValue(grafoAB()),
      saveFromUi,
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      observation: vi.fn().mockImplementation(async (id: string) => detalle(id)),
    }))
    render(<MemoriesWorkspace {...props()} />)
    fireEvent.click(await explorer().findByRole('button', { name: 'New memory' }))
    expect(await screen.findByRole('tab', { name: /New memory/, selected: true })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Memory title' }), { target: { value: 'Nueva a mano' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save memory' }))

    await waitFor(() => expect(saveFromUi).toHaveBeenCalledWith(expect.objectContaining({ title: 'Nueva a mano', worktreePath: null })))
    expect(await screen.findByRole('tab', { name: /Nueva a mano/, selected: true })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /New memory/ })).toBeNull()
    expect(await screen.findByRole('textbox', { name: 'Memory title' })).toHaveValue('Nueva a mano')
  })

  it('Create this memory desde un [[hueco]] abre New memory con ese titulo', async () => {
    setMemoryApi(api({
      graph: vi.fn().mockResolvedValue(grafoAB()),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      observation: vi.fn().mockImplementation(async (id: string) =>
        detalle(id, { content: 'ver [[Falta]]', links: [{ name: 'Falta', syncId: null }] })),
    }))
    render(<MemoriesWorkspace {...props()} />)
    await abrirA()
    await waitFor(() => expect(document.querySelector('[data-wikilink="Falta"]')).not.toBeNull())
    fireEvent.mouseDown(document.querySelector('[data-wikilink="Falta"]')!)
    fireEvent.click(await screen.findByRole('button', { name: 'Create this memory' }))
    expect(await screen.findByRole('tab', { name: /New memory/, selected: true })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveValue('Falta')
  })

  it('Team thread aparece como pestana fija si el repo tiene el hilo', async () => {
    setMemoryApi(api({
      graph: vi.fn().mockResolvedValue(grafoAB()),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: true, projectKey: 'proj1111aaaaaaaa' }),
      teamThreadGetSettings: vi.fn().mockResolvedValue({ ok: true, settings: { enabled: true, includedTypes: ['handoff', 'decision'], writeAgentsPointer: true } }),
      teamThreadRead: vi.fn().mockResolvedValue({ ok: true, branches: [] }),
    }))
    ;(window as unknown as { git: unknown }).git = { info: vi.fn().mockResolvedValue({ branch: 'main', remoteUrl: null, githubUrl: null, isDirty: false }) }
    render(<MemoriesWorkspace {...props({ activeRepoPath: '/r' })} />)
    const hilo = await screen.findByRole('tab', { name: /Team thread/ })
    expect(hilo).toHaveAttribute('aria-selected', 'false')
    // Fija: sin boton de cerrar.
    expect(within(hilo).queryByRole('button', { name: 'Close tab' })).toBeNull()
  })

  it('sin el hilo prendido no hay pestana Team thread', async () => {
    setMemoryApi(api({
      graph: vi.fn().mockResolvedValue(grafoAB()),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: true, projectKey: 'proj1111aaaaaaaa' }),
      teamThreadGetSettings: vi.fn().mockResolvedValue({ ok: true, settings: { enabled: false, includedTypes: [], writeAgentsPointer: false } }),
    }))
    render(<MemoriesWorkspace {...props({ activeRepoPath: '/r' })} />)
    await screen.findByRole('button', { name: 'node Otra' })
    expect(screen.queryByRole('tab', { name: /Team thread/ })).toBeNull()
  })

  it('buscar filtra el explorer y resalta en el grafo', async () => {
    const crossProject = vi.fn().mockImplementation(async (q?: { query?: string }) => (
      q?.query
        ? { items: [{ syncId: 'a', projectKey: 'p1', projectDisplayName: 'raven-nest', title: 'Auth pasa a cookies', type: 'decision', scope: 'project', originAi: null, authorDisplay: null, updatedAt: 1, tags: [] }], nextCursor: null }
        : { items: [], nextCursor: null }
    ))
    setMemoryApi(api({ graph: vi.fn().mockResolvedValue(grafoAB()), crossProject }))
    render(<MemoriesWorkspace {...props()} />)
    expect(await explorer().findByRole('button', { name: 'Otra' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search memories' }), { target: { value: 'auth' } })
    expect(await explorer().findByRole('button', { name: 'Auth pasa a cookies' })).toBeInTheDocument()
    expect(explorer().queryByRole('button', { name: 'Otra' })).toBeNull()
    expect(crossProject).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'auth' }))
    // El grafo no cambia de forma: resalta, no filtra.
    expect(screen.getByRole('button', { name: 'node Otra' })).toBeInTheDocument()
  })

  // Portado de MemoryGraphPanel-chips-tipo.test.tsx. Decision del 20-10: los filtros son
  // DEL GRAFO. Apagar un tipo lo saca del grafo; el explorer sigue mostrando todo.
  it('apagar un tipo en los filtros lo saca del grafo pero no del explorer', async () => {
    setMemoryApi(api({
      graph: vi.fn().mockResolvedValue({
        truncated: 0,
        nodes: [nodo('d1', 'Una decision', 'decision'), nodo('b1', 'Un bugfix', 'bugfix')],
        edges: [{ from: 'd1', to: 'b1', kind: 'similar', directed: false }],
      }),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    }))
    render(<MemoriesWorkspace {...props()} />)
    expect(await screen.findByRole('button', { name: 'node Un bugfix' })).toBeInTheDocument()

    const chip = await panelDerecho().findByRole('button', { name: /Bugfix/ })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'false')

    await waitFor(() => expect(screen.queryByRole('button', { name: 'node Un bugfix' })).toBeNull())
    expect(explorer().getByRole('button', { name: 'Un bugfix' })).toBeInTheDocument()
  })

  // Portado de MemoryGraphPanel-sin-vinculos.test.tsx: antes el cuadro devolvia null; ahora
  // la pestana Graph lo explica y ofrece mostrar las sueltas.
  it('grafo sin aristas con hideOrphans: lo explica y deja mostrar las sueltas', async () => {
    setMemoryApi(api({
      graph: vi.fn().mockResolvedValue({ truncated: 0, nodes: [nodo('a', 'Auth pasa a cookies'), nodo('b', 'Otra')], edges: [] }),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    }))
    render(<MemoriesWorkspace {...props()} />)
    expect(await screen.findByText('Nothing is connected yet — show unconnected to see every memory.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'node Otra' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show unconnected' }))
    expect(await screen.findByRole('button', { name: 'node Otra' })).toBeInTheDocument()
    expect(screen.queryByText(/Nothing is connected yet/)).toBeNull()
  })

  it('sin memorias: el centro y el explorer dicen No memories yet', async () => {
    setMemoryApi(api({
      graph: vi.fn().mockResolvedValue({ truncated: 0, nodes: [], edges: [] }),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    }))
    render(<MemoriesWorkspace {...props()} />)
    await waitFor(() => expect(screen.getAllByText('No memories yet')).toHaveLength(2))
  })

  it('cambio de afuera con cambios locales: Open the newer version la recarga en el lugar', async () => {
    let avisar: (() => void) | null = null
    let version = 1
    const observation = vi.fn().mockImplementation(async (id: string) =>
      version === 1 ? detalle(id) : detalle(id, { title: 'La cambio un agente', updatedAt: 2 }))
    setMemoryApi(api({
      graph: vi.fn().mockResolvedValue(grafoAB()),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      observation,
      updateFromUi: vi.fn().mockResolvedValue({ ok: true }),
      onChanged: (cb: () => void) => { avisar = cb; return () => {} },
    }))
    render(<MemoriesWorkspace {...props()} />)
    await abrirA()
    fireEvent.change(screen.getByRole('textbox', { name: 'Memory title' }), { target: { value: 'Lo que yo escribo' } })

    version = 2
    avisar!()
    fireEvent.click(await screen.findByRole('button', { name: 'Open the newer version' }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveValue('La cambio un agente'))
    expect(screen.getByRole('textbox', { name: 'Memory title' })).not.toHaveAttribute('readonly')
    expect(screen.queryByText('A newer version replaced this one.')).toBeNull()
  })

  it('una memoria reemplazada: Open the newer version abre la que la reemplazo', async () => {
    setMemoryApi(api({
      graph: vi.fn().mockResolvedValue(grafoAB()),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      observation: vi.fn().mockImplementation(async (id: string) => detalle(id, id === 'a' ? { supersededBy: 'b' } : {})),
    }))
    render(<MemoriesWorkspace {...props()} />)
    await abrirA()
    fireEvent.click(await screen.findByRole('button', { name: 'Open the newer version' }))
    expect(await screen.findByRole('tab', { name: /Otra/, selected: true })).toBeInTheDocument()
  })

  it('guardar pasa el resultado entero de updateFromUi al editor', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const updateFromUi = vi.fn().mockResolvedValue({ ok: true, saved: { title: 'Auth editada', content: 'Cuerpo' } })
      setMemoryApi(api({
        graph: vi.fn().mockResolvedValue(grafoAB()),
        crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
        observation: vi.fn().mockImplementation(async (id: string) => detalle(id)),
        updateFromUi,
      }))
      render(<MemoriesWorkspace {...props()} />)
      await abrirA()
      fireEvent.change(screen.getByRole('textbox', { name: 'Memory title' }), { target: { value: 'Auth editada' } })
      await vi.advanceTimersByTimeAsync(1600)
      await waitFor(() => expect(updateFromUi).toHaveBeenCalledWith({ syncId: 'a', title: 'Auth editada', content: 'Cuerpo' }))
      expect(await screen.findByText('Saved')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cerrar la pestana con cambios sin guardar los guarda igual', async () => {
    const updateFromUi = vi.fn().mockResolvedValue({ ok: true })
    setMemoryApi(api({
      graph: vi.fn().mockResolvedValue(grafoAB()),
      crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      observation: vi.fn().mockImplementation(async (id: string) => detalle(id)),
      updateFromUi,
    }))
    render(<MemoriesWorkspace {...props()} />)
    await abrirA()
    fireEvent.change(screen.getByRole('textbox', { name: 'Memory title' }), { target: { value: 'Antes de cerrar' } })
    fireEvent.click(within(screen.getByRole('tab', { name: /Auth pasa a cookies/ })).getByRole('button', { name: 'Close tab' }))
    await waitFor(() => expect(updateFromUi).toHaveBeenCalledWith(expect.objectContaining({ syncId: 'a', title: 'Antes de cerrar' })))
  })
})
