// Spec §4.2: "Cero clicks para el estado, un click para todo lo demas."
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MemoriesItem from '../../components/MemoriesItem'

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
    ok: true, enabled: false, rootDir: '', noteCount: 0, conflictCount: 0, lastGeneratedAt: null,
  }),
  ...over,
})

afterEach(() => { setMemoryApi(undefined) })

describe('MemoriesItem', () => {
  it('expandida muestra el nombre y el texto corto de estado', async () => {
    setMemoryApi(api())
    render(<MemoriesItem expanded onOpen={() => {}} />)

    expect(screen.getByText('Memories')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('142 items · synced')).toBeInTheDocument())
  })

  it('colapsada no muestra texto, pero el punto sigue estando', async () => {
    setMemoryApi(api())
    render(<MemoriesItem expanded={false} onOpen={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('memories-dot')).toBeInTheDocument())
    expect(screen.queryByText('142 items · synced')).not.toBeInTheDocument()
  })

  it('una sesion muda pinta el punto de rojo y lo dice en el title', async () => {
    setMemoryApi(api({
      sessions: vi.fn().mockResolvedValue({
        ok: true,
        sessions: [{
          paneId: 'p1', aiType: 'claude', account: 'claude:Gero Personal',
          health: 'silent', sessionId: null, startedAt: 1,
        }],
        silentCount: 1,
      }),
    }))
    render(<MemoriesItem expanded onOpen={() => {}} />)

    await waitFor(() => {
      expect(screen.getByTestId('memories-dot')).toHaveAttribute('data-dot', 'red')
    })
    expect(screen.getByTitle('Memories · 1 session not writing')).toBeInTheDocument()
  })

  it('un click abre la pantalla', async () => {
    setMemoryApi(api())
    const onOpen = vi.fn()
    render(<MemoriesItem expanded onOpen={onOpen} />)

    fireEvent.click(screen.getByText('Memories'))

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('sin window.memory se sigue renderizando, en gris', async () => {
    setMemoryApi(undefined)
    render(<MemoriesItem expanded onOpen={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('memories-dot')).toHaveAttribute('data-dot', 'grey'))
    expect(screen.getByText('Memories')).toBeInTheDocument()
  })
})
