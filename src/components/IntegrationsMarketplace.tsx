import { useState } from 'react'
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

  return (
    <div className="integrations-modal" role="dialog" aria-label="Integraciones">
      <header>
        <button onClick={() => setTab('personal')} aria-pressed={tab === 'personal'}>Personal</button>
        <button onClick={() => setTab('team')} aria-pressed={tab === 'team'}>Team · Enterprise</button>
        <button onClick={onClose} aria-label="Cerrar">×</button>
      </header>

      {tab === 'personal' && (
        <div>
          <input placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />

          {installed.length > 0 && (
            <section aria-label="Instaladas">
              <h3>Instaladas</h3>
              {installed.map(p => (
                <article key={p.id}>
                  <span>{p.name}</span>
                  <button onClick={() => uninstall(p.id)}>Quitar</button>
                </article>
              ))}
            </section>
          )}

          <section aria-label="Disponibles">
            <h3>Disponibles</h3>
            {available.map(p => (
              <article key={p.id}>
                <span>{p.name}</span>
                <button onClick={() => install(p.id)}>Instalar</button>
              </article>
            ))}
          </section>

          <section aria-label="Próximamente">
            <h3>Próximamente · sumamos integraciones cada semana</h3>
            {comingSoon.map(p => <article key={p.id}><span>{p.name}</span></article>)}
            <button>Pedir integración</button>
          </section>
        </div>
      )}

      {tab === 'team' && (
        <div aria-label="Team Enterprise">
          <h3>Integraciones a medida para tu equipo</h3>
          <p>Las construimos a medida.</p>
          <button onClick={() => window.electronShell.openExternal('https://cal.com/raven/enterprise')}>
            Contactar Enterprise
          </button>
        </div>
      )}
    </div>
  )
}
