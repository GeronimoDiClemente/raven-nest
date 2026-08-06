import { useEffect } from 'react'
import { usePluginConnection } from '../hooks/usePluginConnection'
import { ConnectControl } from './IntegrationsMarketplace'
import type { PluginManifest } from '../types'

interface ConnectionCardProps {
  plugin: PluginManifest
  /** Whether `plugin.id` is already in the user's installed list — passed down
   *  from `useInstalledPlugins()` in ConnectionsView rather than re-derived
   *  here, so every card in the grid shares one `installed` fetch. */
  isInstalled: boolean
  /** Stable `install` from `useInstalledPlugins()`. Called once a connection
   *  is established for a plugin that isn't installed yet — see effect below. */
  install: (pluginId: string) => Promise<void>
}

/**
 * One connectable integration, redesigned as a card (icon + name + one-line
 * description + a compact status LED) with the actual Connect/Disconnect
 * affordance handed off to `ConnectControl` — that's the only place OAuth
 * (Slack deep-link, GitHub session reuse, gcal loopback+PKCE) and the apiKey
 * forms (Notion/Jira) are implemented, so this card never reimplements them.
 *
 * The old marketplace grid required an explicit "Install" step before
 * `ConnectControl` even rendered (only "Installed" plugins got it). Cards
 * collapse that into a single Connect action, so once a plugin's credentials
 * land (`connected` flips true) we install it here if it isn't already —
 * `useBoardRows`/`useInstalledPlugins` still key ticket-source plugins
 * (jira/github) off the installed list, and this keeps that wiring intact
 * without requiring a separate step in the new UI.
 */
export function ConnectionCard({ plugin, isInstalled, install }: ConnectionCardProps) {
  const { connected, loading } = usePluginConnection(plugin.id)

  useEffect(() => {
    if (connected && !isInstalled) void install(plugin.id)
  }, [connected, isInstalled, install, plugin.id])

  const statusClass = loading ? 'cx-status-pending' : connected ? 'cx-status-on' : 'cx-status-off'
  const statusLabel = loading ? 'Checking…' : connected ? 'Connected' : 'Not connected'

  return (
    <article className="integration-card cx-card">
      <span className="integration-icon" style={{ background: plugin.color }} aria-hidden>{plugin.name[0]}</span>
      <div className="integration-meta">
        <span className="integration-name">{plugin.name}</span>
        {plugin.description && <span className="integration-desc">{plugin.description}</span>}
        <span className={`cx-status ${statusClass}`}>
          <i className="cx-led" aria-hidden />
          {statusLabel}
        </span>
      </div>
      <div className="cx-action">
        <ConnectControl plugin={plugin} />
      </div>
    </article>
  )
}

/** Dimmed, non-interactive placeholder for `comingSoon` catalog entries. */
export function ConnectionCardSoon({ plugin }: { plugin: PluginManifest }) {
  return (
    <article className="integration-card cx-card cx-card-soon">
      <span className="integration-icon" style={{ background: plugin.color }} aria-hidden>{plugin.name[0]}</span>
      <div className="integration-meta">
        <span className="integration-name">{plugin.name}</span>
        {plugin.description && <span className="integration-desc">{plugin.description}</span>}
        <span className="cx-status cx-status-soon">
          <i className="cx-led cx-led-dashed" aria-hidden />
          Soon
        </span>
      </div>
    </article>
  )
}
