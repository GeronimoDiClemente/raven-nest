// Spec §5.2: fila de estado arriba, grafo al centro, sin chips de scope.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MemoriesWorkspace from '../../components/MemoriesWorkspace'

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
  // Task 8: hubStats es lo que la card del estado vacio muestra sin repo abierto. Default
  // en 0/0 para que los tests que no la ejercitan (todos menos el del estado vacio) no
  // tengan que preocuparse por ella.
  hubStats: vi.fn().mockResolvedValue({ itemCount: 0, projectCount: 0 }),
  ...over,
})

afterEach(() => { setMemoryApi(undefined); vi.restoreAllMocks() })

const renderWorkspace = (props: {
  onClose?: () => void
  activeRepoPath?: string | null
  onLinkRepo?: () => void
  vistaInicial?: 'memorias' | 'settings'
  onHowItWorks?: () => void
} = {}) =>
  render(
    <MemoriesWorkspace
      onClose={props.onClose ?? (() => {})}
      activeRepoPath={props.activeRepoPath ?? null}
      onOpenFile={() => {}}
      onLinkRepo={props.onLinkRepo}
      vistaInicial={props.vistaInicial}
      onHowItWorks={props.onHowItWorks ?? (() => {})}
      onMemorySettingsTour={() => {}}
    />
  )

describe('MemoriesWorkspace', () => {
  it('muestra el conteo y el vault en la fila de estado', async () => {
    setMemoryApi(api())
    renderWorkspace()

    await waitFor(() => expect(screen.getByText('142 items · synced')).toBeInTheDocument())
    // El numero y la etiqueta son dos nodos separados (Task 8: el numero en
    // font-mono tabular-nums, la etiqueta en .microlabel), no un solo string.
    expect(screen.getByText('866')).toBeInTheDocument()
    expect(screen.getByText('notes')).toBeInTheDocument()
  })

  it('NO renderiza chips de scope — decision 3 de la spec', async () => {
    setMemoryApi(api())
    renderWorkspace()

    await waitFor(() => expect(screen.getByText('142 items · synced')).toBeInTheDocument())
    expect(screen.queryByTestId('scope-selector')).not.toBeInTheDocument()
  })

  it('lista lo bloqueado con su razon — el caso "importe 866, subi 50"', async () => {
    setMemoryApi(api({
      doctor: vi.fn().mockResolvedValue({
        ok: true,
        blockedTotal: 816,
        groups: [{ reason: 'quota_exceeded', count: 816, oldestAt: 1, reversible: true }],
      }),
    }))
    renderWorkspace()

    // El semaforo da el titular y la celda de al lado el desglose con el codigo de razon.
    // El numero del desglose vive en su propio span (font-mono tabular-nums), separado
    // del texto del motivo — por eso se verifican por separado.
    await waitFor(() => expect(screen.getByText('816 blocked')).toBeInTheDocument())
    expect(screen.getByText('816', { selector: '.font-mono' })).toBeInTheDocument()
    expect(screen.getByText(/quota_exceeded · waiting, will retry/)).toBeInTheDocument()
  })

  it('nombra la sesion muda: pane y CLI, no un numero suelto', async () => {
    setMemoryApi(api({
      sessions: vi.fn().mockResolvedValue({
        ok: true,
        sessions: [{
          paneId: 'pane-7', aiType: 'claude', account: 'claude:Gero Personal',
          health: 'silent', sessionId: null, startedAt: 1,
        }],
        silentCount: 1,
      }),
    }))
    renderWorkspace()

    await waitFor(() => expect(screen.getByText(/not writing to memory/i)).toBeInTheDocument())
    expect(screen.getByText(/pane-7/)).toBeInTheDocument()
  })

  // Task 6 (2026-10-19): la linea "Link a repo to also see its branches" vivia en el estado
  // vacio de esta vista — se mudo entera a la seccion "This project & team" de Memory
  // settings (Task 5), asi que las 4 pruebas que la ejercitaban aca se borraron. El
  // contrato sigue existiendo, solo que en otro componente (MemorySettingsView.test.tsx).

  it('la vista principal no tiene configuración', () => {
    renderWorkspace({ activeRepoPath: '/r' })
    expect(screen.queryByText(/Share this project/)).toBeNull()
    expect(screen.queryByText(/Encrypt your memory/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull()
  })

  it('Settings abre la vista de settings y Back vuelve a los nodos', () => {
    renderWorkspace({ activeRepoPath: '/r' })
    fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
    expect(screen.getByText('Memory settings', { selector: '.tw-header-title' })).toBeInTheDocument()
    // Nombre EXACTO, no /Memories/: esa regex tambien matchea el boton "How Memories
    // works" del rail de Memory settings, y getByRole explota por ambiguo.
    fireEvent.click(screen.getByRole('button', { name: 'Memories' }))
    expect(screen.getByText('Memories', { selector: '.tw-header-title' })).toBeInTheDocument()
  })

  it('vistaInicial=settings abre directo en settings', () => {
    renderWorkspace({ activeRepoPath: null, vistaInicial: 'settings' })
    expect(screen.getByText('Memory settings', { selector: '.tw-header-title' })).toBeInTheDocument()
  })

  it('How it works llama al callback', () => {
    const onHowItWorks = vi.fn()
    renderWorkspace({ activeRepoPath: null, onHowItWorks })
    fireEvent.click(screen.getByRole('button', { name: 'How it works' }))
    expect(onHowItWorks).toHaveBeenCalled()
  })

  // Fix round 1 de la tarea 1: el Set de tipos ocultos vive en MemoriesWorkspace y tiene
  // que llegar a los DOS paneles — el harness chico de
  // MemoryGraphPanel-chips-tipo.test.tsx ya probaba el cableado en el aire; esto prueba
  // que MemoriesWorkspace de verdad lo conecta.
  it('un chip de tipo lo apaga en el grafo y esconde su fila en la lista (spec §2)', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)

    const nodoDelGrafo = (syncId: string, type: string, title: string) => ({
      syncId, projectKey: 'raven-nest', projectDisplayName: 'Raven Nest',
      tags: [], title, type,
      scope: 'personal' as const, topicKey: null, gitBranch: 'main', originAi: null,
      authorDisplay: null, updatedAt: Date.now(), superseded: false,
    })
    const itemDeLaLista = (syncId: string, type: string, title: string) => ({
      syncId, projectKey: 'raven-nest', projectDisplayName: 'raven-nest',
      title, type, scope: 'project' as const, originAi: null, authorDisplay: null,
      updatedAt: Date.now(), tags: [],
    })

    setMemoryApi(api({
      graph: vi.fn().mockResolvedValue({
        nodes: [
          nodoDelGrafo('d1', 'decision', 'Una decision'),
          nodoDelGrafo('b1', 'bugfix', 'Un bugfix'),
        ],
        edges: [{ from: 'd1', to: 'b1', kind: 'similar', directed: false }],
        truncated: 0,
      }),
      observation: vi.fn().mockResolvedValue(null),
      crossProject: vi.fn().mockResolvedValue({
        items: [
          itemDeLaLista('d1', 'decision', 'Una decision'),
          itemDeLaLista('b1', 'bugfix', 'Un bugfix'),
        ],
        nextCursor: null,
      }),
    }))

    renderWorkspace()

    await waitFor(() => expect(screen.getByText('Un bugfix')).toBeInTheDocument())

    const chip = await screen.findByRole('button', { name: /Bugfix/ })
    expect(chip).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(screen.queryByText('Un bugfix')).toBeNull())
    // La decision sigue — sólo se apagó el tipo clickeado, en los dos paneles a la vez.
    expect(screen.getByText('Una decision')).toBeInTheDocument()
  })

  it('el boton de volver cierra', async () => {
    setMemoryApi(api())
    const onClose = vi.fn()
    renderWorkspace({ onClose })

    fireEvent.click(screen.getByRole('button', { name: /back/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
