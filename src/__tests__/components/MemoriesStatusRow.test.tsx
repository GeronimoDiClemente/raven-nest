// Spec 2026-09-11 §2: "la configuracion del vault sale de la vista principal". Task 6
// (2026-10-19): el icono/popover de ajustes del vault tambien se va de esta fila —
// MemoryVaultCard ahora vive en la seccion "Notes on disk" de Memory settings.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MemoriesStatusRow from '../../components/MemoriesStatusRow'
import type { MemoriesState } from '../../hooks/useMemories'

vi.mock('../../components/UpgradeModal', () => ({ default: () => <div>upgrade-modal</div> }))
vi.mock('../../hooks/useProfile', () => ({ useProfile: () => ({ plan: 'free' }) }))

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
  maxProjects: null,
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

describe('MemoriesStatusRow — el tope del plan no es una falla (spec 2b-1 §4.5)', () => {
  const conTope = (count: number, maxProjects: number | null): MemoriesState => ({
    ...state,
    maxProjects,
    blocked: [{ reason: 'project_limit_reached', count, oldestAt: 1, reversible: true }],
    blockedTotal: count,
  })

  it('dice que se quedan en esta máquina, en gris y sin el código crudo', () => {
    render(<MemoriesStatusRow state={conTope(7, 1)} />)
    const badge = screen.getByText('7 memories stay on this machine — your plan syncs one project')
    expect(badge.className).toContain('text-muted-foreground')
    expect(badge.className).not.toContain('text-warn')
    expect(screen.queryByText(/project_limit_reached/)).toBeNull()
  })

  it('singular, y el número que diga el plan', () => {
    render(<MemoriesStatusRow state={conTope(1, 3)} />)
    expect(screen.getByText('1 memory stays on this machine — your plan syncs 3 projects')).toBeInTheDocument()
  })

  it('Upgrade abre el modal de planes', () => {
    render(<MemoriesStatusRow state={conTope(7, 1)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(screen.getByText('upgrade-modal')).toBeInTheDocument()
  })

  it('los demás motivos siguen como antes, sin Upgrade', () => {
    render(<MemoriesStatusRow state={{ ...state, blocked: [{ reason: 'quota_exceeded', count: 3, oldestAt: 1, reversible: true }], blockedTotal: 3 }} />)
    expect(screen.getByText(/quota_exceeded · waiting, will retry/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })
})
