// Integraciones instaladas promovidas a ítems del menú (spec §2).
// Solo muestra las que tienen adapter registrado (hito 1: 'demo').
import { useInstalledPlugins } from '../hooks/useInstalledPlugins'
import { BUILTIN_CATALOG } from '../lib/plugins/builtinCatalog'
import { hasAdapter } from '../integrations/registry'

export function SidebarIntegrationItems({ onOpen }: { onOpen: (pluginId: string) => void }) {
  const { installed } = useInstalledPlugins()
  const items = installed.filter((p) => p.enabled && hasAdapter(p.pluginId))
  if (items.length === 0) return null
  return (
    <>
      {items.map((p) => {
        const manifest = BUILTIN_CATALOG.find((m) => m.id === p.pluginId)
        return (
          <div key={p.pluginId} className="sidebar-item sidebar-item-panel" style={{ cursor: 'pointer' }}
            onClick={() => onOpen(p.pluginId)} title={manifest?.name ?? p.pluginId}>
            <span className="sidebar-icon" style={{ color: manifest?.color }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="12" height="12" rx="3.5" stroke="currentColor" strokeWidth="1.4" />
                <path d="M5.5 8h5M8 5.5v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </span>
            <span className="sidebar-label">{manifest?.name ?? p.pluginId}</span>
          </div>
        )
      })}
    </>
  )
}
