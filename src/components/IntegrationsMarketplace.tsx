import { useState, type ReactNode } from 'react'
import { usePluginCatalog } from '../hooks/usePluginCatalog'
import { useInstalledPlugins } from '../hooks/useInstalledPlugins'
import type { PluginManifest } from '../types'

/**
 * Contenido del marketplace de integraciones (tabs, búsqueda, grids de
 * instaladas/disponibles/coming-soon y tab de team). No incluye el overlay
 * ni el botón de cerrar: se usa embebido dentro de `MyReposPanel` (sección
 * "Integrations") y también como cuerpo del modal legacy `IntegrationsMarketplace`.
 * `headerActions` permite inyectar controles extra (ej. el botón de cerrar
 * del modal) sin duplicar el header.
 */
export function IntegrationsMarketplaceView({ headerActions }: { headerActions?: ReactNode } = {}) {
  const { catalog } = usePluginCatalog()
  const { install, uninstall, isInstalled } = useInstalledPlugins()
  const [tab, setTab] = useState<'personal' | 'team'>('personal')
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
      <header className="integrations-header">
        <div className="integrations-tabs">
          <button className={`integrations-tab${tab === 'personal' ? ' active' : ''}`} onClick={() => setTab('personal')} aria-pressed={tab === 'personal'}>Personal</button>
          <button className={`integrations-tab${tab === 'team' ? ' active' : ''}`} onClick={() => setTab('team')} aria-pressed={tab === 'team'}>Team · Enterprise</button>
        </div>
        {headerActions}
      </header>

      <div className="integrations-body">
        {tab === 'personal' && (
          <>
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
          </>
        )}

        {tab === 'team' && (
          <div className="integrations-team" aria-label="Team Enterprise">
            <h3 className="integrations-team-title">Custom integrations for your team</h3>
            <ul className="integrations-team-list">
              <li>Centralized Slack alerts for the team</li>
              <li>Bidirectional Jira ↔ worktree sync</li>
              <li>Your internal tool — whatever you need</li>
            </ul>
            <p className="integrations-team-sub">We build them to spec.</p>
            <button className="integration-btn primary" onClick={() => window.electronShell.openExternal('https://cal.com/raven/enterprise')}>
              Contact Enterprise
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Modal legacy a nivel de app (sidebar global). Se elimina en Task C del plan
 * de migración a My Repos; hasta entonces queda como wrapper delgado sobre
 * `IntegrationsMarketplaceView`.
 */
export function IntegrationsMarketplace({ onClose }: { onClose: () => void }) {
  return (
    <div className="integrations-overlay" onClick={onClose}>
      <div className="integrations-modal" role="dialog" aria-label="Integrations" onClick={e => e.stopPropagation()}>
        <IntegrationsMarketplaceView
          headerActions={<button className="integrations-close" onClick={onClose} aria-label="Close">×</button>}
        />
      </div>
    </div>
  )
}
