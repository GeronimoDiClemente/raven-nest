import { useState, useEffect, useCallback } from 'react'
import type { InstalledPlugin } from '../types'

// Evento window para sincronizar todas las instancias del hook: instalar desde
// el marketplace debe refrescar la Sidebar (y viceversa) sin recargar la app.
const PLUGINS_CHANGED_EVENT = 'nest:plugins-changed'

export function useInstalledPlugins() {
  const [installed, setInstalled] = useState<InstalledPlugin[]>([])

  const refresh = useCallback(async () => {
    setInstalled(await window.plugins.list())
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const onChanged = () => { void refresh() }
    window.addEventListener(PLUGINS_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(PLUGINS_CHANGED_EVENT, onChanged)
  }, [refresh])

  const install = useCallback(async (pluginId: string, config: Record<string, unknown> = {}) => {
    await window.plugins.save({ pluginId, scope: 'personal', enabled: true, config })
    window.dispatchEvent(new CustomEvent(PLUGINS_CHANGED_EVENT))
    await refresh()
  }, [refresh])

  const uninstall = useCallback(async (pluginId: string) => {
    await window.plugins.delete(pluginId)
    window.dispatchEvent(new CustomEvent(PLUGINS_CHANGED_EVENT))
    await refresh()
  }, [refresh])

  const isInstalled = useCallback(
    (id: string) => installed.some((p) => p.pluginId === id),
    [installed],
  )

  return { installed, install, uninstall, isInstalled, refresh }
}
