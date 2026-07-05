// MyReposPanel tiene muchas dependencias pesadas (supabase, GitHub/GitLab
// hooks). No existe otro test de MyReposPanel para copiar: se mockean los
// hooks de datos (patrón de Sidebar-integrations.test.tsx /
// TeamsWorkspace-open-terminal.test.tsx) para montar el panel sin red ni
// supabase real y ejercitar solo la navegación a la sección Integrations.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../hooks/useUserRepos', () => ({
  useUserRepos: () => ({
    repos: [], loading: false, refresh: vi.fn(),
    addRepo: vi.fn(), updateLocalPath: vi.fn(), removeRepo: vi.fn(),
  }),
}))

vi.mock('../../hooks/useGitHubNotifications', () => ({
  useGitHubNotifications: () => ({ notifications: [], unreadCount: 0, markAsRead: vi.fn() }),
}))

vi.mock('../../hooks/useGitlab', () => ({
  useGitlab: () => ({
    isConnected: false, gitlabLogin: null, gitlabToken: null, loading: false, error: null,
    connectGitlab: vi.fn(), disconnectGitlab: vi.fn(),
  }),
}))

// usePluginCatalog toca supabase (no configurado en test) — se mockea para
// servir el catálogo builtin de forma síncrona, igual que en el test de
// IntegrationsMarketplaceView.
vi.mock('../../hooks/usePluginCatalog', () => ({
  usePluginCatalog: () => ({
    catalog: [{ id: 'demo', name: 'Demo', description: 'Demo plugin', category: 'other', icon: 'demo', color: '#123', type: 'integration', publisher: 'raven', tier: 'free', auth: { kind: 'none' } }],
    loading: false,
    source: 'builtin',
  }),
}))

import MyReposPanel from '../../components/MyReposPanel'

describe('MyReposPanel — sección Integrations', () => {
  beforeEach(() => {
    // window.plugins es requerido por useInstalledPlugins (usado dentro de
    // IntegrationsMarketplaceView) para no explotar al montar.
    ;(globalThis as unknown as { window: Window }).window.plugins = {
      list: vi.fn(() => Promise.resolve([])),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    } as never
  })

  it('el nav muestra "Integrations" y clickearlo renderiza el marketplace embebido', async () => {
    render(
      <MyReposPanel
        onClose={vi.fn()}
        githubToken={null}
        githubLogin={null}
        onConnectGitHub={vi.fn()}
        onOpenRepoTerminal={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /integrations/i }))
    expect(await screen.findByText('Available')).toBeInTheDocument()
    expect(screen.getByText('Demo')).toBeInTheDocument()
    // No debe mostrar el placeholder de "conectá GitHub/GitLab" en esta sección.
    expect(screen.queryByText('Connect GitHub or GitLab to use My Repos')).not.toBeInTheDocument()
  })
})
