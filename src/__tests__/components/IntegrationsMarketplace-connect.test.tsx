// Estados de Connect en el marketplace (Hito 2+ Task F1): apiKey (form
// inline), oauth/slack (openOAuth + exchangeCode) y oauth/github (reuso del
// token existente de la sesión de la app). No se ejercita contra IPC real —
// se mockean window.plugins/pluginCreds/slack y el hook useGitHub.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import type { PluginManifest, InstalledPlugin } from '../../types'

vi.mock('../../hooks/usePluginCatalog', () => ({
  usePluginCatalog: () => ({ catalog: CATALOG, loading: false, source: 'builtin' }),
}))

vi.mock('../../hooks/useGitHub')

const CATALOG: PluginManifest[] = [
  {
    id: 'jira', name: 'Jira', description: 'Jira integration', category: 'pm', icon: 'jira', color: '#0052CC',
    type: 'integration', publisher: 'raven', tier: 'free',
    auth: {
      kind: 'apiKey',
      fields: [
        { key: 'email', label: 'Email', type: 'text', required: true, placeholder: 'you@company.com' },
        { key: 'apiToken', label: 'API token', type: 'password', required: true },
        { key: 'siteUrl', label: 'Site URL', type: 'text', required: true, placeholder: 'https://x.atlassian.net' },
      ],
    },
  },
  {
    id: 'slack', name: 'Slack', description: 'Slack integration', category: 'comms', icon: 'slack', color: '#4A154B',
    type: 'integration', publisher: 'raven', tier: 'free', auth: { kind: 'oauth' },
  },
  {
    id: 'github', name: 'GitHub', description: 'GitHub integration', category: 'pm', icon: 'github', color: '#181717',
    type: 'integration', publisher: 'raven', tier: 'free', auth: { kind: 'oauth' },
  },
]

import { IntegrationsMarketplaceView } from '../../components/IntegrationsMarketplace'
import { useGitHub } from '../../hooks/useGitHub'

const mockedUseGitHub = vi.mocked(useGitHub)

describe('IntegrationsMarketplaceView — Connect state', () => {
  let installed: InstalledPlugin[]
  let credsStore: Record<string, string>
  let slackCb: ((code: string) => void) | null

  beforeEach(() => {
    installed = [
      { pluginId: 'jira', scope: 'personal', enabled: true, config: {} },
      { pluginId: 'slack', scope: 'personal', enabled: true, config: {} },
      { pluginId: 'github', scope: 'personal', enabled: true, config: {} },
    ]
    credsStore = {}
    slackCb = null

    ;(globalThis as unknown as { window: Window }).window.plugins = {
      list: vi.fn(() => Promise.resolve(installed)),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    } as never

    window.pluginCreds = {
      has: vi.fn((id: string) => Promise.resolve(id in credsStore)),
      set: vi.fn((id: string, token: string) => { credsStore[id] = token; return Promise.resolve({ ok: true }) }),
      delete: vi.fn((id: string) => { delete credsStore[id]; return Promise.resolve() }),
    } as never

    window.slack = {
      openOAuth: vi.fn(() => Promise.resolve()),
      onOAuthCode: vi.fn((cb: (code: string) => void) => { slackCb = cb; return () => { slackCb = null } }),
      removeOAuthListener: vi.fn(() => { slackCb = null }),
      // El exchange real persiste el token main-side (slack:exchange-code en
      // main.ts, vía pluginCreds.setToken) — acá simulamos ese efecto para
      // poder verificar que el renderer refleja el nuevo estado "Connected".
      exchangeCode: vi.fn(() => { credsStore.slack = 'xoxb-fake'; return Promise.resolve({ ok: true }) }),
    } as never

    mockedUseGitHub.mockReturnValue({
      isConnected: false, githubLogin: null, githubToken: null, loading: false, error: null,
      connectGitHub: vi.fn(), disconnectGitHub: vi.fn(),
    })
  })

  it('apiKey (Jira): Connect muestra el form, Save persiste JSON en pluginCreds y pasa a Connected', async () => {
    render(<IntegrationsMarketplaceView />)
    await screen.findByText('Installed')
    const jiraCard = screen.getByText('Jira').closest('article')!
    fireEvent.click(within(jiraCard).getByRole('button', { name: 'Connect' }))

    fireEvent.change(within(jiraCard).getByPlaceholderText('you@company.com'), { target: { value: 'me@co.com' } })
    fireEvent.change(within(jiraCard).getByPlaceholderText('https://x.atlassian.net'), { target: { value: 'https://co.atlassian.net' } })
    // API token es type="password": no tiene placeholder de texto propio útil para getByPlaceholderText
    // en combinación con los otros dos, así que lo tomamos por selector directo.
    const passwordInput = jiraCard.querySelector('input[type="password"]') as HTMLInputElement
    fireEvent.change(passwordInput, { target: { value: 'tok-abc' } })

    fireEvent.click(within(jiraCard).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(window.pluginCreds.set).toHaveBeenCalledWith('jira', JSON.stringify({
        email: 'me@co.com', siteUrl: 'https://co.atlassian.net', apiToken: 'tok-abc',
      }))
    })
    await waitFor(() => expect(within(jiraCard).getByText('Connected ✓')).toBeInTheDocument())
  })

  it('oauth (Slack): Connect abre OAuth, el code recibido se intercambia y pasa a Connected', async () => {
    render(<IntegrationsMarketplaceView />)
    await screen.findByText('Installed')
    const slackCard = screen.getByText('Slack').closest('article')!
    fireEvent.click(within(slackCard).getByRole('button', { name: 'Connect' }))

    expect(window.slack.openOAuth).toHaveBeenCalled()
    expect(slackCb).not.toBeNull()

    await act(async () => { slackCb!('the-code') })

    expect(window.slack.exchangeCode).toHaveBeenCalledWith('the-code')
    await waitFor(() => expect(within(slackCard).getByText('Connected ✓')).toBeInTheDocument())
  })

  it('oauth (GitHub): si la app ya tiene sesión de GitHub, reusa el token sin pedir Connect', async () => {
    mockedUseGitHub.mockReturnValue({
      isConnected: true, githubLogin: 'gero', githubToken: 'gh-tok', loading: false, error: null,
      connectGitHub: vi.fn(), disconnectGitHub: vi.fn(),
    })
    render(<IntegrationsMarketplaceView />)
    await screen.findByText('Installed')
    const githubCard = screen.getByText('GitHub').closest('article')!
    await waitFor(() => expect(window.pluginCreds.set).toHaveBeenCalledWith('github', 'gh-tok'))
    await waitFor(() => expect(within(githubCard).getByText('Connected ✓')).toBeInTheDocument())
  })

  it('Disconnect borra la credencial y vuelve a mostrar Connect', async () => {
    credsStore.jira = JSON.stringify({ email: 'x' })
    render(<IntegrationsMarketplaceView />)
    await screen.findByText('Installed')
    const jiraCard = screen.getByText('Jira').closest('article')!
    await waitFor(() => expect(within(jiraCard).getByText('Connected ✓')).toBeInTheDocument())

    fireEvent.click(within(jiraCard).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(window.pluginCreds.delete).toHaveBeenCalledWith('jira'))
    await waitFor(() => expect(within(jiraCard).getByRole('button', { name: 'Connect' })).toBeInTheDocument())
  })
})
