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

afterEach(() => { setMemoryApi(undefined) })

const renderWorkspace = (props: {
  onClose?: () => void
  activeRepoPath?: string | null
  onLinkRepo?: () => void
} = {}) =>
  render(
    <MemoriesWorkspace
      onClose={props.onClose ?? (() => {})}
      activeRepoPath={props.activeRepoPath ?? null}
      onOpenFile={() => {}}
      onLinkRepo={props.onLinkRepo}
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

  it('sin repo abierto, la pantalla ofrece algo en vez de una frase suelta', async () => {
    // El problema real medido en la captura del 2026-09-09: header, una tira de
    // estado, una frase y 80% de negro. El estado vacio tiene que dar una SALIDA
    // (un boton que vincula un repo) y mostrar lo que si existe sin uno: los
    // totales de la cuenta via hubStats() (no hay dato de la memoria __global__
    // en el renderer — ver la nota en MemoriesWorkspace.tsx).
    setMemoryApi(api({
      // Numeros distintos del noteCount del vault (866) del mock por defecto — asi el
      // assert de abajo no puede confundir un numero con el otro.
      hubStats: vi.fn().mockResolvedValue({ itemCount: 214, projectCount: 5 }),
    }))
    const onLinkRepo = vi.fn()
    renderWorkspace({ activeRepoPath: null, onLinkRepo })

    expect(screen.getByRole('button', { name: /link a repo/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/214 memories across 5 projects/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /link a repo/i }))
    expect(onLinkRepo).toHaveBeenCalledTimes(1)
  })

  it('sin onLinkRepo, no renderiza el boton pero el arbol sigue montando', async () => {
    // Contrato defensivo (Task 8, resolucion 2): la prop es opcional para que un
    // caller viejo (o un test viejo) que no la pasa no vea reventar el componente.
    setMemoryApi(api())
    renderWorkspace({ activeRepoPath: null })

    await waitFor(() => expect(screen.getByText('142 items · synced')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /link a repo/i })).not.toBeInTheDocument()
  })

  it('hubStats opcional o que falla no revienta la card', async () => {
    // Mismo contrato defensivo que useMemories: window.memory.hubStats es opcional
    // en el tipo, y si la llamada falla la card se muestra sin los numeros.
    setMemoryApi(api({ hubStats: vi.fn().mockRejectedValue(new Error('nope')) }))
    renderWorkspace({ activeRepoPath: null, onLinkRepo: () => {} })

    await waitFor(() => expect(screen.getByRole('button', { name: /link a repo/i })).toBeInTheDocument())
  })

  it('el estado vacio mantiene la escala tipografica en titulo y descripcion (Task 8b review I4 / Task 8c parte 3)', async () => {
    // El guard de contraste (e2e/04-contraste.spec.ts:178) mide COLOR, y
    // MemoriesWorkspace-tokens.test.tsx solo regexea el source sin montar el
    // arbol — ninguno de los dos hubiera agarrado que alguien borre el
    // className="text-fs-lg" de CardTitle. Este SI renderiza el estado vacio
    // de verdad y lee la className del nodo real, no del texto fuente.
    setMemoryApi(api({
      hubStats: vi.fn().mockResolvedValue({ itemCount: 214, projectCount: 5 }),
    }))
    renderWorkspace({ activeRepoPath: null, onLinkRepo: () => {} })

    // El texto cambio el 2026-09-11: desde que MemoryGraphPanel muestra el grafo de
    // MEMORIAS arriba de esta card, decir "to see its memory graph" contradecia lo que el
    // usuario tenia en pantalla. Lo que falta sin repo es el grafo de RAMAS. El contrato
    // que este test protege es la escala tipografica, no la copy.
    const title = await screen.findByText('Link a repo to see its branches')
    expect(title.className.split(/\s+/)).toContain('text-fs-lg')

    const description = await screen.findByText(/214 memories across 5 projects/)
    // 'text-fs' a secas, no 'text-fs-lg': son escalones distintos de la
    // escala (CardDescription vs CardTitle) — toContain con split evita que
    // un match de substring confunda uno con el otro.
    expect(description.className.split(/\s+/)).toContain('text-fs')
    expect(description.className.split(/\s+/)).not.toContain('text-fs-lg')
  })

  it('el boton de volver cierra', async () => {
    setMemoryApi(api())
    const onClose = vi.fn()
    renderWorkspace({ onClose })

    fireEvent.click(screen.getByRole('button', { name: /back/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
