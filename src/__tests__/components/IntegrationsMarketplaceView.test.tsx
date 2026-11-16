import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntegrationsMarketplaceView } from '../../components/IntegrationsMarketplace'
import { BUILTIN_CATALOG } from '../../lib/plugins/builtinCatalog'

// usePluginCatalog toca supabase (no configurado en el entorno de test) —
// se mockea para servir el catálogo builtin de forma síncrona.
vi.mock('../../hooks/usePluginCatalog', () => ({
  usePluginCatalog: () => ({ catalog: BUILTIN_CATALOG, loading: false, source: 'builtin' }),
}))

// useInstalledPlugins NO se mockea: se ejercita real contra window.plugins.
describe('IntegrationsMarketplaceView (embebida, sin overlay)', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: Window }).window.plugins = {
      list: vi.fn(() => Promise.resolve([])),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    } as never
  })

  it('lista el catálogo disponible sin renderizar overlay/modal', () => {
    const { container } = render(<IntegrationsMarketplaceView />)
    expect(screen.getByText('Slack')).toBeInTheDocument()
    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(container.querySelector('.integrations-overlay')).not.toBeInTheDocument()
    expect(container.querySelector('.integrations-modal')).not.toBeInTheDocument()
    expect(container.querySelector('.integrations-close')).not.toBeInTheDocument()
  })

  it('Instalar llama a window.plugins.save', async () => {
    render(<IntegrationsMarketplaceView />)
    fireEvent.click(screen.getAllByText('Install')[0])
    await waitFor(() => {
      expect(window.plugins.save).toHaveBeenCalledWith(
        expect.objectContaining({ pluginId: expect.any(String), scope: 'personal', enabled: true }),
      )
    })
  })

  it('filtra por búsqueda', () => {
    render(<IntegrationsMarketplaceView />)
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'jira' } })
    expect(screen.getByText('Jira')).toBeInTheDocument()
    expect(screen.queryByText('Slack')).not.toBeInTheDocument()
  })

  it('no tiene tabs ni pitch de Team · Enterprise — es exclusivamente el marketplace personal', () => {
    const { container } = render(<IntegrationsMarketplaceView />)
    expect(container.querySelector('.integrations-tabs')).not.toBeInTheDocument()
    expect(screen.queryByText('Personal')).not.toBeInTheDocument()
    expect(screen.queryByText('Team · Enterprise')).not.toBeInTheDocument()
    expect(screen.queryByText('Custom integrations for your team')).not.toBeInTheDocument()
    expect(screen.queryByText('Contact Enterprise')).not.toBeInTheDocument()
  })
})
