// Corte comercial 2026-09-02: lo local es gratis en todos los planes. Compartir un
// workspace a Team/Community usaba `if (plan === 'free') { onRequireUpgrade?.(); return }`
// (WorkspacePanel.tsx) — se saco junto con la prop `onRequireUpgrade`, que quedo sin
// ningun uso en el componente. Este test prueba que la accion ocurre sin ningun gate
// de por medio.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../hooks/useTeam', () => ({ useTeam: () => ({ team: null }) }))

const share = vi.fn().mockResolvedValue(true)
vi.mock('../../hooks/useSharedWorkspaces', () => ({
  useSharedWorkspaces: () => ({
    items: [],
    loading: false,
    userId: null,
    refresh: vi.fn(),
    share,
    remove: vi.fn(),
  }),
}))

import WorkspacePanel from '../../components/WorkspacePanel'

describe('WorkspacePanel — sin el gate de plan', () => {
  beforeEach(() => {
    share.mockClear()
    window.workspaces = {
      list: vi.fn().mockResolvedValue([
        { id: 'ws-1', name: 'Mi workspace', layout: { rows: 1, cols: 1 }, panes: [] },
      ]),
      save: vi.fn(),
      delete: vi.fn(),
      exportToFile: vi.fn(),
      importFromFile: vi.fn(),
    } as never
  })

  it('comparte un workspace sin ningun gate de plan de por medio', async () => {
    render(<WorkspacePanel onSave={vi.fn()} onLoad={vi.fn()} />)

    fireEvent.click(screen.getByTitle('Workspaces'))
    await waitFor(() => expect(screen.getByText('Mi workspace')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('Share to Community'))

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
  })
})
