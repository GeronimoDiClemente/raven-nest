import { usePluginCatalog } from '../hooks/usePluginCatalog'
import { useInstalledPlugins } from '../hooks/useInstalledPlugins'
import { ConnectionCard, ConnectionCardSoon } from './ConnectionCard'

/**
 * Connections tab of the Integrations Hub — one card per catalog integration.
 * The OAuth/apiKey implementation lives in IntegrationsMarketplaceView, reused
 * via ConnectControl (see ConnectionCard.tsx). Cards for entries without `auth` (or `auth.kind
 * === 'none'`, e.g. the internal "demo" fixture) are skipped — there's
 * nothing to connect, so they don't belong in this view.
 */
export function ConnectionsView() {
  const { catalog } = usePluginCatalog()
  const { install, isInstalled } = useInstalledPlugins()

  const connectable = catalog.filter((p) => !p.comingSoon && p.auth && p.auth.kind !== 'none')
  const comingSoon = catalog.filter((p) => p.comingSoon)

  return (
    <div className="ih-connections">
      <div className="cx-body">
        <div className="cx-grid">
          {connectable.map((p) => (
            <ConnectionCard key={p.id} plugin={p} isInstalled={isInstalled(p.id)} install={install} />
          ))}
          {comingSoon.map((p) => (
            <ConnectionCardSoon key={p.id} plugin={p} />
          ))}
        </div>
      </div>
    </div>
  )
}
