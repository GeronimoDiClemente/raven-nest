import { useState, type ReactNode } from 'react'
import { usePluginCatalog } from '../hooks/usePluginCatalog'
import { useInstalledPlugins } from '../hooks/useInstalledPlugins'
import type { PluginManifest } from '../types'

export function IntegrationsMarketplace({ onClose }: { onClose: () => void }) {
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
    <div className="integrations-overlay" onClick={onClose}>
      <div className="integrations-modal" role="dialog" aria-label="Integraciones" onClick={e => e.stopPropagation()}>
        <header className="integrations-header">
          <div className="integrations-tabs">
            <button className={`integrations-tab${tab === 'personal' ? ' active' : ''}`} onClick={() => setTab('personal')} aria-pressed={tab === 'personal'}>Personal</button>
            <button className={`integrations-tab${tab === 'team' ? ' active' : ''}`} onClick={() => setTab('team')} aria-pressed={tab === 'team'}>Team · Enterprise</button>
          </div>
          <button className="integrations-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        <div className="integrations-body">
          {tab === 'personal' && (
            <>
              <input className="integrations-search" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />

              {installed.length > 0 && (
                <section aria-label="Instaladas">
                  <h3 className="integrations-section-title">Instaladas</h3>
                  <div className="integrations-grid">
                    {installed.map(p => card(p, <button className="integration-btn ghost" onClick={() => uninstall(p.id)}>Quitar</button>))}
                  </div>
                </section>
              )}

              <section aria-label="Disponibles">
                <h3 className="integrations-section-title">Disponibles</h3>
                <div className="integrations-grid">
                  {available.map(p => card(p, <button className="integration-btn primary" onClick={() => install(p.id)}>Instalar</button>))}
                </div>
              </section>

              <section aria-label="Próximamente">
                <h3 className="integrations-section-title">Próximamente · sumamos integraciones cada semana</h3>
                <div className="integrations-grid">
                  {comingSoon.map(p => card(p, <span className="integration-soon-tag">Pronto</span>))}
                </div>
                <button className="integration-request">Pedir integración</button>
              </section>
            </>
          )}

          {tab === 'team' && (
            <div className="integrations-team" aria-label="Team Enterprise">
              <h3 className="integrations-team-title">Integraciones a medida para tu equipo</h3>
              <ul className="integrations-team-list">
                <li>Alerts de Slack centralizados para el equipo</li>
                <li>Sync bidireccional Jira ↔ worktrees</li>
                <li>Tu herramienta interna — lo que necesiten</li>
              </ul>
              <p className="integrations-team-sub">Las construimos a medida.</p>
              <button className="integration-btn primary" onClick={() => window.electronShell.openExternal('https://cal.com/raven/enterprise')}>
                Contactar Enterprise
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
