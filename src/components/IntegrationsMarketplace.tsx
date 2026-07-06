import { useState, type ReactNode } from 'react'
import { usePluginCatalog } from '../hooks/usePluginCatalog'
import { useInstalledPlugins } from '../hooks/useInstalledPlugins'
import type { PluginManifest } from '../types'

/**
 * Marketplace personal de integraciones (búsqueda, grids de
 * instaladas/disponibles/coming-soon). Se usa embebido dentro de
 * `MyReposPanel` (sección "Integrations"). El pitch de Team · Enterprise
 * vive aparte en `TeamIntegrationsView`, embebido en `TeamsWorkspace`.
 */
export function IntegrationsMarketplaceView() {
  const { catalog } = usePluginCatalog()
  const { install, uninstall, isInstalled } = useInstalledPlugins()
  const [q, setQ] = useState('')

  const match = (p: PluginManifest) => p.name.toLowerCase().includes(q.toLowerCase())
  const visible = catalog.filter(match)
  const available = visible.filter(p => !p.comingSoon && !isInstalled(p.id))
  const comingSoon = visible.filter(p => p.comingSoon)
  const installed = visible.filter(p => isInstalled(p.id))

  const card = (p: PluginManifest, action: ReactNode) => (
    <article key={p.id} className="integration-card">
      <span className="integration-icon" style={{ background: p.color }} aria-hidden>{p.name[0]}</span>
      <div className="integration-meta">
        <span className="integration-name">{p.name}</span>
        {p.description && <span className="integration-desc">{p.description}</span>}
      </div>
      {action}
    </article>
  )

  return (
    <div className="integrations-embedded">
      <div className="integrations-body">
        <input className="integrations-search" placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} />

        {installed.length > 0 && (
          <section aria-label="Installed">
            <h3 className="integrations-section-title">Installed</h3>
            <div className="integrations-grid">
              {installed.map(p => card(p, <button className="integration-btn ghost" onClick={() => uninstall(p.id)}>Remove</button>))}
            </div>
          </section>
        )}

        <section aria-label="Available">
          <h3 className="integrations-section-title">Available</h3>
          <div className="integrations-grid">
            {available.map(p => card(p, <button className="integration-btn primary" onClick={() => install(p.id)}>Install</button>))}
          </div>
        </section>

        <section aria-label="Coming soon">
          <h3 className="integrations-section-title">Coming soon · new integrations every week</h3>
          <div className="integrations-grid">
            {comingSoon.map(p => card(p, <span className="integration-soon-tag">Soon</span>))}
          </div>
          <button className="integration-request">Request an integration</button>
        </section>
      </div>
    </div>
  )
}
