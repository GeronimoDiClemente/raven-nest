// @vitest-environment jsdom
// ConnectionsView (Connections tab of the Integrations Hub): one clean
// ConnectionCard per connectable catalog entry — icon/name/description,
// a status LED ("Connected"/"Not connected"), and the Connect/Disconnect
// affordance reused unmodified from IntegrationsMarketplace's ConnectControl
// (OAuth/apiKey logic lives there and only there). Mirrors the mocking setup
// from IntegrationsMarketplace-connect.test.tsx: usePluginCatalog + a fake
// window.plugins/pluginCreds/slack, plus useGitHub for the GitHub card.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { PluginManifest, InstalledPlugin } from '../../types'

vi.mock('../../hooks/usePluginCatalog', () => ({
  usePluginCatalog: () => ({ catalog: CATALOG, loading: false, source: 'builtin' }),
}))

vi.mock('../../hooks/useGitHub')

const CATALOG: PluginManifest[] = [
  {
    id: 'github', name: 'GitHub', description: 'Track issues and PRs for the active worktree.',
    category: 'pm', icon: 'github', color: '#181717', type: 'integration', publisher: 'raven', tier: 'free',
    auth: { kind: 'oauth' },
  },
  {
    id: 'jira', name: 'Jira', description: 'Create worktrees from Jira issues.',
    category: 'pm', icon: 'jira', color: '#0052CC', type: 'integration', publisher: 'raven', tier: 'free',
    auth: {
      kind: 'apiKey',
      fields: [{ key: 'email', label: 'Email', type: 'text', required: true, placeholder: 'you@company.com' }],
    },
  },
  {
    id: 'demo', name: 'Demo', description: 'Demo panel for the integrations shell.',
    category: 'comms', icon: 'demo', color: '#0066FF', type: 'integration', publisher: 'raven', tier: 'free',
    auth: { kind: 'none' },
  },
  {
    id: 'figma', name: 'Figma', description: 'Coming soon.',
    category: 'design', icon: 'figma', color: '#F24E1E', type: 'integration', publisher: 'raven', tier: 'free',
    comingSoon: true,
  },
]

import { ConnectionsView } from '../../components/ConnectionsView'
import { useGitHub } from '../../hooks/useGitHub'

const mockedUseGitHub = vi.mocked(useGitHub)

describe('ConnectionsView', () => {
  let installed: InstalledPlugin[]
  let credsStore: Record<string, string>

  beforeEach(() => {
    installed = []
    credsStore = {}

    ;(globalThis as unknown as { window: Window }).window.plugins = {
      list: vi.fn(() => Promise.resolve(installed)),
      save: vi.fn((p: InstalledPlugin) => {
        installed = [...installed.filter((x) => x.pluginId !== p.pluginId), p]
        return Promise.resolve()
      }),
      delete: vi.fn((id: string) => { installed = installed.filter((x) => x.pluginId !== id); return Promise.resolve() }),
    } as never

    window.pluginCreds = {
      has: vi.fn((id: string) => Promise.resolve(id in credsStore)),
      set: vi.fn((id: string, token: string) => { credsStore[id] = token; return Promise.resolve({ ok: true }) }),
      delete: vi.fn((id: string) => { delete credsStore[id]; return Promise.resolve() }),
    } as never

    window.slack = {
      openOAuth: vi.fn(() => Promise.resolve()),
      onOAuthCode: vi.fn(() => () => {}),
      removeOAuthListener: vi.fn(),
      exchangeCode: vi.fn(() => Promise.resolve({ ok: true })),
    } as never

    mockedUseGitHub.mockReturnValue({
      isConnected: false, githubLogin: null, githubToken: null, loading: false, error: null,
      connectGitHub: vi.fn(), disconnectGitHub: vi.fn(),
    })
  })

  it('renders an ordered card per connectable integration, with icon, name and description', () => {
    render(<ConnectionsView />)

    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.getByText('Track issues and PRs for the active worktree.')).toBeInTheDocument()
    expect(screen.getByText('Jira')).toBeInTheDocument()
    expect(screen.getByText('Create worktrees from Jira issues.')).toBeInTheDocument()
  })

  it('skips catalog entries with no auth (e.g. the internal "demo" fixture) — nothing to connect', () => {
    render(<ConnectionsView />)
    expect(screen.queryByText('Demo')).not.toBeInTheDocument()
  })

  it('shows a dimmed, non-interactive "Soon" card for coming-soon integrations', () => {
    render(<ConnectionsView />)

    const figmaCard = screen.getByText('Figma').closest('article')!
    expect(within(figmaCard).getByText('Soon')).toBeInTheDocument()
    expect(within(figmaCard).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the grey "Not connected" status and a Connect control for a disconnected integration', async () => {
    render(<ConnectionsView />)

    const githubCard = screen.getByText('GitHub').closest('article')!
    await waitFor(() => expect(within(githubCard).getByText('Not connected')).toBeInTheDocument())
    expect(within(githubCard).getByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })

  it('apiKey (Jira): Connect shows the form, Save persists creds and flips the status LED to Connected', async () => {
    render(<ConnectionsView />)
    const jiraCard = screen.getByText('Jira').closest('article')!

    fireEvent.click(await within(jiraCard).findByRole('button', { name: 'Connect' }))
    fireEvent.change(within(jiraCard).getByPlaceholderText('you@company.com'), { target: { value: 'me@co.com' } })
    fireEvent.click(within(jiraCard).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(window.pluginCreds.set).toHaveBeenCalledWith('jira', JSON.stringify({ email: 'me@co.com' })))
    await waitFor(() => expect(within(jiraCard).getByText('Connected')).toBeInTheDocument())
    expect(within(jiraCard).getByText('Connected ✓')).toBeInTheDocument()
  })

  it('connecting a plugin that was never installed also installs it, so useBoardRows keeps picking up its tickets', async () => {
    // Simulates the GitHub-session-reuse path (ConnectControl auto-persists
    // the token from Settings when github.isConnected is already true).
    mockedUseGitHub.mockReturnValue({
      isConnected: true, githubLogin: 'gero', githubToken: 'gh-tok', loading: false, error: null,
      connectGitHub: vi.fn(), disconnectGitHub: vi.fn(),
    })
    render(<ConnectionsView />)
    const githubCard = screen.getByText('GitHub').closest('article')!

    await waitFor(() => expect(within(githubCard).getByText('Connected')).toBeInTheDocument())
    await waitFor(() => expect(window.plugins.save).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: 'github', scope: 'personal', enabled: true }),
    ))
  })

  it('Disconnect clears the credential and flips the status back to Not connected', async () => {
    credsStore.jira = JSON.stringify({ email: 'x' })
    render(<ConnectionsView />)
    const jiraCard = screen.getByText('Jira').closest('article')!

    await waitFor(() => expect(within(jiraCard).getByText('Connected')).toBeInTheDocument())
    fireEvent.click(within(jiraCard).getByRole('button', { name: 'Disconnect' }))

    await waitFor(() => expect(window.pluginCreds.delete).toHaveBeenCalledWith('jira'))
    await waitFor(() => expect(within(jiraCard).getByText('Not connected')).toBeInTheDocument())
  })
})
