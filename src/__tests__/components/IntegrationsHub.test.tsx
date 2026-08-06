// @vitest-environment jsdom
// IntegrationsHub mounts the orchestration board (useBoardRows + OrchestrationBoard)
// plus the IntegrationsRail inside the teams-workspace overlay shell. Mock the
// same window bridges useBoardRows needs (pattern from hooks/useBoardRows.test.tsx)
// so the hook resolves without touching real IPC.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { Ticket, WorktreeMeta, WorktreeSignalDTO } from '../../types'

const mockUseInstalledPlugins = vi.fn()
vi.mock('../../hooks/useInstalledPlugins', () => ({
  useInstalledPlugins: () => mockUseInstalledPlugins(),
}))

// usePluginCatalog toca supabase (no configurado en el entorno de test) — se
// mockea para servir el catálogo builtin de forma síncrona, para que el tab
// Connections (que renderiza un ConnectionCard por integración, ver
// ConnectionsView.tsx/ConnectionCard.tsx) renderice sin esperar la resolución.
vi.mock('../../hooks/usePluginCatalog', () => ({
  usePluginCatalog: () => ({
    catalog: BUILTIN_CATALOG,
    loading: false,
    source: 'builtin',
  }),
}))

import { IntegrationsHub } from '../../components/IntegrationsHub'
import { BUILTIN_CATALOG } from '../../lib/plugins/builtinCatalog'

beforeEach(() => {
  // installed/install/uninstall/isInstalled: shape consumed both by
  // useBoardRows (via the "installed" field) and by ConnectionCard (rendered
  // on the Connections tab), which also needs install/isInstalled.
  mockUseInstalledPlugins.mockReturnValue({
    installed: [], install: vi.fn(), uninstall: vi.fn(), isInstalled: () => false,
  })
  Object.assign(window as unknown as Record<string, unknown>, {
    tickets: {
      list: vi.fn().mockResolvedValue([]),
      tracked: vi.fn().mockResolvedValue([]),
    },
    worktree: { listAll: vi.fn().mockResolvedValue({ ok: true, worktrees: [] }) },
    signals: { list: vi.fn().mockResolvedValue([]), onUpdate: vi.fn(() => () => {}) },
    recipes: {
      list: vi.fn().mockResolvedValue([
        { id: 'default:pr.merged', when: 'pr.merged', commands: ['updateStatus: done'] },
      ]),
    },
    automations: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    // ConnectionCard mounts ConnectControl unconditionally for every
    // connectable plugin (unlike the old Installed/Available grid, which
    // only mounted it for installed ones) — usePluginConnection needs this
    // to resolve without throwing for the Connections tab test.
    pluginCreds: {
      has: vi.fn().mockResolvedValue(false),
      set: vi.fn().mockResolvedValue({ ok: true }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  })
})

describe('IntegrationsHub', () => {
  it('shows the hub tabs and the board empty state', async () => {
    render(<IntegrationsHub onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Hub' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('No tasks yet')).toBeInTheDocument())
  })

  it('calls onClose when the back button is clicked', async () => {
    const onClose = vi.fn()
    render(<IntegrationsHub onClose={onClose} />)

    await waitFor(() => expect(screen.getByText('No tasks yet')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Back'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the rail alongside the board', async () => {
    render(<IntegrationsHub onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('No tasks yet')).toBeInTheDocument())
    expect(screen.getByText('@Nest')).toBeInTheDocument()
  })

  it('switches to the Recipes tab and shows its content', async () => {
    render(<IntegrationsHub onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('No tasks yet')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Recipes' }))

    await waitFor(() => expect(screen.getByText('pr.merged')).toBeInTheDocument())
    expect(screen.queryByText('No tasks yet')).not.toBeInTheDocument()
  })

  it('switches to the Automations tab and shows the scheduled-agents view', async () => {
    render(<IntegrationsHub onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('No tasks yet')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Automations' }))

    expect(screen.getByRole('heading', { name: 'Automations' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/No automations yet/)).toBeInTheDocument())
    expect(screen.queryByText('No tasks yet')).not.toBeInTheDocument()
  })

  it('switches to the Connections tab and renders a card per integration', async () => {
    render(<IntegrationsHub onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('No tasks yet')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Connections' }))

    expect(await screen.findByText('GitHub')).toBeInTheDocument()
    expect(await within(screen.getByText('GitHub').closest('article')!).findByRole('button', { name: 'Connect' })).toBeInTheDocument()
    expect(screen.getByText('Figma')).toBeInTheDocument()
    expect(screen.queryByText('No tasks yet')).not.toBeInTheDocument()
  })

  describe('with rows spanning an org and a personal ticket', () => {
    const ticketOrg: Ticket = { key: 'A-1', providerId: 'a1', title: 'Ticket A', url: '', state: 'in_review', context: '' }
    const ticketPersonal: Ticket = { key: 'B-1', providerId: 'b1', title: 'Ticket B', url: '', state: 'todo', context: '' }
    const worktreeOrg: WorktreeMeta = {
      repoPath: '/ra', rootRepoPath: '/ra', branch: 'gero/a-1', setupState: 'running',
      declaredPorts: [], detectedPorts: [], createdAt: 0, updatedAt: 0,
    }
    const signalOrg: WorktreeSignalDTO = { repoPath: '/ra', ci: 'success', changesRequested: false, repo: 'OrgOne/x' }

    beforeEach(() => {
      mockUseInstalledPlugins.mockReturnValue({
        installed: [{ pluginId: 'github', scope: 'personal', enabled: true, config: {} }],
      })
      Object.assign(window as unknown as Record<string, unknown>, {
        tickets: {
          list: vi.fn().mockResolvedValue([ticketOrg, ticketPersonal]),
          tracked: vi.fn().mockResolvedValue([{ branch: worktreeOrg.branch, ticketKey: ticketOrg.key }]),
        },
        worktree: { listAll: vi.fn().mockResolvedValue({ ok: true, worktrees: [worktreeOrg] }) },
        signals: { list: vi.fn().mockResolvedValue([signalOrg]), onUpdate: vi.fn(() => () => {}) },
      })
    })

    it('shows a scope filter and narrows the board when Personal is picked', async () => {
      render(<IntegrationsHub onClose={vi.fn()} />)

      await waitFor(() => expect(screen.getByText('Ticket A')).toBeInTheDocument())
      expect(screen.getByText('Ticket B')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'OrgOne' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Personal' }))

      expect(screen.getByText('Ticket B')).toBeInTheDocument()
      expect(screen.queryByText('Ticket A')).not.toBeInTheDocument()
    })
  })
})
