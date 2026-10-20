// Spec §5.2: fila de estado arriba, grafo al centro, sin chips de scope. Las tres columnas
// estilo Obsidian (explorer, pestañas, panel) se prueban en MemoriesWorkspace-obsidian.test.tsx.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
  // Task 8: hubStats es lo que la card del estado vacio muestra sin repo abierto. Default
  // en 0/0 para que los tests que no la ejercitan (todos menos el del estado vacio) no
  // tengan que preocuparse por ella.
  hubStats: vi.fn().mockResolvedValue({ itemCount: 0, projectCount: 0 }),
  ...over,
})

beforeEach(() => { __reiniciarPestanas() })
afterEach(() => { setMemoryApi(undefined); vi.restoreAllMocks() })

const renderWorkspace = (props: {
  onClose?: () => void
  activeRepoPath?: string | null
  onLinkRepo?: () => void
  vistaInicial?: 'memorias' | 'settings'
  onHowItWorks?: () => void
  onVistaChange?: (vista: 'memorias' | 'settings') => void
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
      onVistaChange={props.onVistaChange}
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

  // El caso "un chip de tipo lo apaga en el grafo y esconde su fila en la lista" se fue con
  // la lista (20-10, Memories estilo Obsidian): los filtros por tipo son del grafo y el
  // explorer no se filtra por tipo. Lo cubre MemoriesWorkspace-obsidian.test.tsx.

  // Review final de rama, IMPORTANT #5: antes, el unico dato que `App.tsx` tenia de la
  // vista era `vistaInicial` (leida una sola vez, al montar) — navegar el rail puertas
  // adentro (Settings → Back) no se lo avisaba a nadie. `onVistaChange` es el cable que
  // faltaba: tiene que avisar el valor inicial AL MONTAR (no solo los cambios de ahi en
  // mas), y despues cada navegacion interna.
  it('onVistaChange avisa la vista inicial al montar y cada navegacion interna', () => {
    const onVistaChange = vi.fn()
    renderWorkspace({ activeRepoPath: '/r', onVistaChange })

    expect(onVistaChange).toHaveBeenCalledWith('memorias')
    onVistaChange.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
    expect(onVistaChange).toHaveBeenCalledWith('settings')
    onVistaChange.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Memories' }))
    expect(onVistaChange).toHaveBeenCalledWith('memorias')
  })

  it('onVistaChange con vistaInicial=settings avisa "settings" desde el montaje', () => {
    const onVistaChange = vi.fn()
    renderWorkspace({ activeRepoPath: null, vistaInicial: 'settings', onVistaChange })
    expect(onVistaChange).toHaveBeenCalledWith('settings')
  })

  it('el boton de volver cierra', async () => {
    setMemoryApi(api())
    const onClose = vi.fn()
    renderWorkspace({ onClose })

    fireEvent.click(screen.getByRole('button', { name: /back/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
