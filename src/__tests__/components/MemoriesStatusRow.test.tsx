// Spec 2026-09-11 §2: "la configuracion del vault sale de la vista principal". Task 6
// (2026-10-19): el icono/popover de ajustes del vault tambien se va de esta fila —
// MemoryVaultCard ahora vive en la seccion "Notes on disk" de Memory settings.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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

  it('no hay boton de ajustes del vault — MemoryVaultCard vive en Memory settings', () => {
    setMemoryApi({
      vaultGetSettings: vi.fn().mockResolvedValue({
        ok: true,
        settings: { version: 1, enabled: true, root: '/x', includeSuperseded: true, includeTeamScope: true },
        rootDir: '/Users/gero/.raven-nest/memory-vault/user-1',
      }),
    })
    render(<MemoriesStatusRow state={state} />)

    expect(screen.queryByRole('button', { name: /memory vault settings/i })).not.toBeInTheDocument()
  })
})
