import { IntegrationsMarketplaceView } from './IntegrationsMarketplace'

/**
 * Connections tab of the Integrations Hub — reuses the personal marketplace
 * (search + Installed/Available/Coming soon) so users can connect/install
 * integrations without leaving the hub. `IntegrationsMarketplaceView` reads
 * everything off hooks (usePluginCatalog, useInstalledPlugins) and needs no
 * props/context, same as how MyReposPanel embeds it for its "Integrations"
 * section — this just gives the hub its own full-width host for it.
 */
export function ConnectionsView() {
  return (
    <div className="ih-connections">
      <IntegrationsMarketplaceView />
    </div>
  )
}
