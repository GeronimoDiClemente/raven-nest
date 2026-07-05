// MyReposPanel tiene muchas dependencias pesadas (supabase, GitHub/GitLab
// hooks). No existe otro test de MyReposPanel para copiar: se mockean los
// hooks de datos (patrón de Sidebar-integrations.test.tsx /
// TeamsWorkspace-open-terminal.test.tsx) para montar el panel sin red ni
// supabase real y ejercitar solo la navegación a la sección Integrations.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'

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

// useGitInfo pega contra window.git (IPC) — se mockea sin branch para
// ejercitar el empty state ("Pick an item on the left") del shell embebido.
vi.mock('../../hooks/useGitInfo', () => ({
  useGitInfo: () => ({ branch: null, githubUrl: null, isDirty: false, refresh: vi.fn() }),
}))

import MyReposPanel from '../../components/MyReposPanel'

function renderPanel() {
  return render(
    <MyReposPanel
      onClose={vi.fn()}
      githubToken={null}
      githubLogin={null}
      onConnectGitHub={vi.fn()}
      onOpenRepoTerminal={vi.fn()}
      activeRepoPath={null}
    />,
  )
}

describe('MyReposPanel — sección Integrations', () => {
  let pluginsList: Array<{ pluginId: string; scope: 'personal' | 'team'; enabled: boolean; config: Record<string, unknown> }>

  beforeEach(() => {
    pluginsList = []
    // window.plugins es requerido por useInstalledPlugins (usado dentro de
    // IntegrationsMarketplaceView y del grupo "Installed" del nav) para no
    // explotar al montar.
    ;(globalThis as unknown as { window: Window }).window.plugins = {
      list: vi.fn(() => Promise.resolve(pluginsList)),
      save: vi.fn((entry: { pluginId: string; scope: 'personal' | 'team'; enabled: boolean; config: Record<string, unknown> }) => {
        pluginsList = [...pluginsList.filter(p => p.pluginId !== entry.pluginId), entry]
        return Promise.resolve()
      }),
      delete: vi.fn((pluginId: string) => {
        pluginsList = pluginsList.filter(p => p.pluginId !== pluginId)
        return Promise.resolve()
      }),
    } as never
  })

  it('el nav muestra "Integrations" y clickearlo renderiza el marketplace embebido', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /integrations/i }))
    expect(await screen.findByText('Available')).toBeInTheDocument()
    expect(screen.getByText('Demo')).toBeInTheDocument()
    // No debe mostrar el placeholder de "conectá GitHub/GitLab" en esta sección.
    expect(screen.queryByText('Connect GitHub or GitLab to use My Repos')).not.toBeInTheDocument()
  })

  it('no muestra el grupo "Installed" si no hay integraciones instaladas con adapter', async () => {
    renderPanel()
    const nav = await screen.findByRole('navigation')
    await within(nav).findByRole('button', { name: /^repos$/i })
    expect(within(nav).queryByText('Installed')).not.toBeInTheDocument()
  })

  it('instalar Demo desde el marketplace muestra el ítem en el nav sin remount, y clickearlo abre el shell embebido', async () => {
    renderPanel()
    const nav = screen.getByRole('navigation')
    fireEvent.click(screen.getByRole('button', { name: /integrations/i }))
    await screen.findByText('Available')

    fireEvent.click(screen.getByRole('button', { name: /install/i }))
    const demoNavBtn = await within(nav).findByRole('button', { name: /^demo$/i })
    expect(within(nav).getByText('Installed')).toBeInTheDocument()

    fireEvent.click(demoNavBtn)
    expect(await screen.findByText(/My work/)).toBeInTheDocument()
    expect(screen.getByText('Pick an item on the left')).toBeInTheDocument()
  })

  it('desinstalar la integración cuyo panel está abierto vuelve al marketplace', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /integrations/i }))
    await screen.findByText('Available')
    fireEvent.click(screen.getByRole('button', { name: /install/i }))
    const demoNavBtn = await screen.findByRole('button', { name: /^demo$/i })
    fireEvent.click(demoNavBtn)
    await screen.findByText('Pick an item on the left')

    // Simula la desinstalación disparada desde otra instancia (ej. la Sidebar
    // legacy en Task C, o esta misma vista si se reabriera el marketplace):
    // actualiza el mock de window.plugins y despacha el evento de sync que
    // useInstalledPlugins escucha para refrescarse sin remount.
    await act(async () => {
      await window.plugins.delete('demo')
      window.dispatchEvent(new CustomEvent('nest:plugins-changed'))
    })

    expect(await screen.findByText('Available')).toBeInTheDocument()
    expect(screen.queryByText('Pick an item on the left')).not.toBeInTheDocument()
  })
})
