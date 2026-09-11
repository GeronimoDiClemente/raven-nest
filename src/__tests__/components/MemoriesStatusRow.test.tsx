// Spec 2026-09-11 §2: "la configuracion del vault sale de la vista principal" — vive
// atras de un icono en la fila de estado, no como card fija compitiendo con la lista.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MemoriesStatusRow from '../../components/MemoriesStatusRow'
import type { MemoriesState } from '../../hooks/useMemories'

const setMemoryApi = (api: unknown): void => {
  ;(window as unknown as { memory?: unknown }).memory = api
}

afterEach(() => { setMemoryApi(undefined) })

const state: MemoriesState = {
  status: { dot: 'green', text: '142 items · synced' },
  itemCount: 142,
  pendingCount: 0,
  connected: true,
  sessions: [],
  silentSessions: [],
  blocked: [],
  blockedTotal: 0,
  vault: { enabled: false, rootDir: '', noteCount: 0, conflictCount: 0, lastGeneratedAt: null },
  refresh: async () => {},
}

describe('MemoriesStatusRow — configuracion del vault', () => {
  it('no muestra el path ni los checkboxes del vault en la fila (van atras del icono)', () => {
    setMemoryApi({
      vaultGetSettings: vi.fn().mockResolvedValue({
        ok: true,
        settings: { version: 1, enabled: true, root: '/x', includeSuperseded: true, includeTeamScope: true },
        rootDir: '/Users/gero/.raven-nest/memory-vault/user-1',
      }),
    })
    render(<MemoriesStatusRow state={state} />)

    expect(screen.queryByText(/memory-vault\/user-1/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Include superseded/)).not.toBeInTheDocument()
  })

  it('el icono de settings abre un popover con MemoryVaultCard', async () => {
    setMemoryApi({
      vaultGetSettings: vi.fn().mockResolvedValue({
        ok: true,
        settings: { version: 1, enabled: true, root: '/x', includeSuperseded: true, includeTeamScope: true },
        rootDir: '/Users/gero/.raven-nest/memory-vault/user-1',
      }),
    })
    render(<MemoriesStatusRow state={state} />)

    fireEvent.click(screen.getByRole('button', { name: /memory vault settings/i }))

    await waitFor(() => expect(screen.getByText(/memory-vault\/user-1/)).toBeInTheDocument())
    expect(screen.getByText(/Include superseded/)).toBeInTheDocument()
  })
})
