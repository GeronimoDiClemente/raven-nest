import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IntegrationsMarketplace } from '../../components/IntegrationsMarketplace'
import { BUILTIN_CATALOG } from '../../lib/plugins/builtinCatalog'

vi.mock('../../hooks/usePluginCatalog', () => ({
  usePluginCatalog: () => ({ catalog: BUILTIN_CATALOG, loading: false, source: 'builtin' }),
}))
const installMock = vi.fn()
vi.mock('../../hooks/useInstalledPlugins', () => ({
  useInstalledPlugins: () => ({
    installed: [], install: installMock, uninstall: vi.fn(), isInstalled: () => false, refresh: vi.fn(),
  }),
}))

describe('IntegrationsMarketplace', () => {
  it('lista disponibles y separa las coming-soon', () => {
    render(<IntegrationsMarketplace onClose={() => {}} />)
    expect(screen.getByText('Slack')).toBeInTheDocument()
    expect(screen.getByText('Coming soon · new integrations every week')).toBeInTheDocument()
  })

  it('filtra por búsqueda', () => {
    render(<IntegrationsMarketplace onClose={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'jira' } })
    expect(screen.getByText('Jira')).toBeInTheDocument()
    expect(screen.queryByText('Slack')).not.toBeInTheDocument()
  })

  it('Instalar dispara install()', () => {
    render(<IntegrationsMarketplace onClose={() => {}} />)
    fireEvent.click(screen.getAllByText('Install')[0])
    expect(installMock).toHaveBeenCalled()
  })
})
