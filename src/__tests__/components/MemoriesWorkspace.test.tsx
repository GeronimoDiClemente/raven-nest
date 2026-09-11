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

  it('sin repo abierto, la pantalla ofrece una salida y dice para que sirve', async () => {
    // El problema medido en la captura del 2026-09-09: header, una tira de estado, una
    // frase y 80% de negro. El estado vacio tiene que dar una SALIDA (un boton que
    // vincula un repo) y decir que se gana vinculandolo.
    //
    // 2026-09-11: ya no muestra "tenes N memorias en M proyectos". Desde que la LISTA
    // muestra las memorias de verdad, ese contador era una version peor de lo que el
    // usuario ya tiene arriba — y era una card de 250px que le robaba el alto a la lista.
    // Ahora es una linea. El contrato que sobrevive es el que importa: hay una salida, y
    // esta dicho de que se trata.
    setMemoryApi(api())
    const onLinkRepo = vi.fn()
    renderWorkspace({ activeRepoPath: null, onLinkRepo })

    expect(screen.getByText(/Link a repo to also see its branches/)).toBeInTheDocument()

    const boton = screen.getByRole('button', { name: /link a repo/i })
    fireEvent.click(boton)
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

  it('la linea del estado vacio se mantiene en la escala tipografica', async () => {
    // El guard de contraste (e2e/04-contraste.spec.ts:178) mide COLOR, y
    // MemoriesWorkspace-tokens.test.tsx solo regexea el source sin montar el arbol —
    // ninguno de los dos agarraria que alguien le ponga un text-sm de Tailwind en vez de
    // la escala propia (--fs-*). Este SI renderiza y lee la className del nodo real.
    //
    // Antes esto miraba el CardTitle/CardDescription de una card que ya no existe (ver el
    // test de arriba). El contrato es el mismo: el texto de esta pantalla no inventa
    // tamaños fuera de la escala.
    setMemoryApi(api())
    renderWorkspace({ activeRepoPath: null, onLinkRepo: () => {} })

    const linea = await screen.findByText(/Link a repo to also see its branches/)
    expect(linea.className.split(/\s+/)).toContain('text-fs-sm')
  })

  it('el boton de volver cierra', async () => {
    setMemoryApi(api())
    const onClose = vi.fn()
    renderWorkspace({ onClose })

    fireEvent.click(screen.getByRole('button', { name: /back/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
